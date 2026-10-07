module Codec exposing
    ( factsDecoder
    , factsFromString
    , encodeDirective
    , encodeCapability
    , encodeFailureReason
    , decodeCapabilityMap
    , encodeCapabilityMap
    )


{-| JSON wire contract for the completion-continuation-control kernel.

Inbound facts arrive as tagged JSON. Outbound directives leave as tagged
JSON. The mapping is closed and FROZEN per ACT §C10. Adding a new tag is
a breaking change for the wire contract and the differential
correspondence fixtures.

Closed wire schema (C10):

Inbound `Facts`:

  {
    "unconsumedCount": Int,
    "observation": { "observeHeldResults": Bool, "retryCompletion": Bool }?,
    "completion":   { "observeHeldResults": Bool, "retryCompletion": Bool }?,
    "stalledNoProgress": Bool,
    "sessionMatches": Bool,
    "taskMatches": Bool,
    "alreadyCommitted": Bool
  }

NOTE: `observation` and `completion` share the same shape because both
represent "what can the host do" — they are SEPARATE semantically
(observation = observe held results, completion = re-issue completion)
and SEPARATE in the wire shape. Each carries the closed enum mapping; a
missing key on either field is mapped to the closed `emptyCapabilityMap`.

Outbound `Directive`:

  { "tag": "observe_then_retry" }
  { "tag": "retry_completion" }
  { "tag": "wait_for_host" }
  { "tag": "fail_closed", "reason": "observation_unavailable" | ... }
-}
import Domain exposing (..)
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode exposing (Value)


-- ---------------------------------------------------------------------------
-- Inbound decoder (Facts)
-- ---------------------------------------------------------------------------


factsDecoder : Decoder Facts
factsDecoder =
    Decode.map7 Facts
        (Decode.field "unconsumedCount" Decode.int)
        (optionalCapabilityMap "observation")
        (optionalCapabilityMap "completion")
        (Decode.field "stalledNoProgress" Decode.bool)
        (Decode.field "sessionMatches" Decode.bool)
        (Decode.field "taskMatches" Decode.bool)
        (Decode.field "alreadyCommitted" Decode.bool)


{-| Decode the inbound JSON STRING into the typed `Facts`.

C15 / C10 invariant: TS serializes the inbound facts through
`JSON.stringify` and feeds the JSON STRING to the kernel. The kernel
must parse the JSON before running the schema decoder so strict
`typeof` checks fire (e.g. `"yes"` for a Bool field fails).

`Decode.decodeValue` is not enough: it would run the schema against the
raw JS object, bypassing the JSON primitive typing. `Decode.decodeString`
calls `JSON.parse` first, which coerces only valid JSON literals --
strings stay strings, booleans stay booleans, null stays null -- and
the schema's `Decode.bool` then refuses anything that is not `boolean`.
-}
factsFromString : String -> Result Decode.Error Facts
factsFromString =
    Decode.decodeString factsDecoder


{-| Decode a `CapabilityMap` from the named field, falling back to
`emptyCapabilityMap` when the field is absent. Per C15, a missing
optional capability field is *fail-open* into `emptyCapabilityMap`
rather than failing the whole facts decode — the policy then fails
closed via the `RetryUnavailable` branch (no retry capability).
-}
optionalCapabilityMap : String -> Decoder CapabilityMap
optionalCapabilityMap fieldName =
    Decode.oneOf
        [ Decode.field fieldName decodeCapabilityMap
        , Decode.succeed emptyCapabilityMap
        ]


{-| Decoder for the closed `CapabilityMap` record.
-}
decodeCapabilityMap : Decoder CapabilityMap
decodeCapabilityMap =
    Decode.map2 CapabilityMap
        (Decode.field "observeHeldResults" Decode.bool)
        (Decode.field "retryCompletion" Decode.bool)


-- ---------------------------------------------------------------------------
-- Outbound encoder (Directive)
-- ---------------------------------------------------------------------------


encodeDirective : Directive -> Value
encodeDirective d =
    case d of
        ObserveThenRetry ->
            Encode.object [ ( "tag", Encode.string "observe_then_retry" ) ]

        RetryCompletion ->
            Encode.object [ ( "tag", Encode.string "retry_completion" ) ]

        WaitForHost ->
            Encode.object [ ( "tag", Encode.string "wait_for_host" ) ]

        FailClosed reason ->
            Encode.object
                [ ( "tag", Encode.string "fail_closed" )
                , ( "reason", Encode.string (encodeFailureReason reason) )
                ]


encodeFailureReason : FailureReason -> String
encodeFailureReason r =
    case r of
        ObservationUnavailable ->
            "observation_unavailable"

        RetryUnavailable ->
            "retry_unavailable"

        StalledNoProgress ->
            "stalled_no_progress"

        SessionMismatch ->
            "session_mismatch"

        TaskMismatch ->
            "task_mismatch"

        AlreadyCommitted ->
            "already_committed"

        MalformedFacts ->
            "malformed_facts"


encodeCapability : Capability -> String
encodeCapability c =
    case c of
        ObserveHeldResults ->
            "observe_held_results"

        CanRetryCompletion ->
            "retry_completion"


encodeCapabilityMap : CapabilityMap -> Value
encodeCapabilityMap m =
    Encode.object
        [ ( "observeHeldResults", Encode.bool m.observeHeldResults )
        , ( "retryCompletion", Encode.bool m.retryCompletion )
        ]