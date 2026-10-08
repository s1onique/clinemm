module Codec exposing
    ( factsDecoder
    , factsFromString
    , encodeDirective
    , encodeCapability
    , encodeFailureReason
    , decodeCapabilityMap
    , encodeCapabilityMap
    , encodeHeldSetProgress
    , decodeHeldSetProgress
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
    "priorHeldSetSorted":   [String],
    "currentHeldSetSorted": [String],
    "sessionMatches": Bool,
    "taskMatches": Bool,
    "alreadyCommitted": Bool
  }

NOTE: `observation` and `completion` share the same shape because both
represent "what can the host do" — they are SEPARATE semantically
(observation = observe held results, completion = re-issue completion)
and SEPARATE in the wire shape. Each carries the closed enum mapping; a
missing key on either field is mapped to the closed `emptyCapabilityMap`.

ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C8 / C10):

  The `stalledNoProgress: Bool` field that AUTHORITY02 used to accept
  from the host is REMOVED. The schema gains TWO new REQUIRED fields:

    - `priorHeldSetSorted`   — `[]` means "no prior snapshot"
                                  (first call / cleared)
    - `currentHeldSetSorted` — canonical sorted list at the current
                                  call

  Both are decoded as `List String`. The schema decoder rejects
  non-list / non-string values (the strict-typing invariant from
  AUTHORITY02 C15). A missing field on EITHER fails the WHOLE facts
  decode (the new fields are required, unlike the optional
  capability maps).

Outbound `Directive`:

  { "tag": "observe_then_retry" }
  { "tag": "retry_completion" }
  { "tag": "wait_for_host" }
  { "tag": "fail_closed", "reason": "observation_unavailable" | ... }

Outbound `HeldSetProgress` (used for diagnostic transparency in
the policy's return value; the policy itself returns a `Directive`,
the `HeldSetProgress` is encoded for the differential correspondence
fixtures and the `Main.elm` outbound message):

  "indeterminate" | "no_progress" | "passive_accumulation"
  | "contraction_or_membership_shift"
-}
import Domain exposing (..)
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode exposing (Value)


-- ---------------------------------------------------------------------------
-- Inbound decoder (Facts)
-- ---------------------------------------------------------------------------


factsDecoder : Decoder Facts
factsDecoder =
    Decode.map8 Facts
        (Decode.field "unconsumedCount" Decode.int)
        (optionalCapabilityMap "observation")
        (optionalCapabilityMap "completion")
        (sortedStringListDecoder "priorHeldSetSorted")
        (sortedStringListDecoder "currentHeldSetSorted")
        (Decode.field "sessionMatches" Decode.bool)
        (Decode.field "taskMatches" Decode.bool)
        (Decode.field "alreadyCommitted" Decode.bool)


{-| Strict `List String` decoder. Rejects non-list, non-string,
and empty-string values (the empty-string rejection preserves the
`factsIsExpected` invariant — see Domain.elm C8).

The decoder does NOT verify the list is sorted. The
`classifyHeldSetProgress` helper relies on the closed-schema
contract that the host pre-sorts; a mis-sorted list would produce
a deterministic (but semantically wrong) classification, which is
the same behavior the predecessor TS policy had via
`localeCompare`. This keeps the decoder side-effect-free.
-}
sortedStringListDecoder : String -> Decoder (List String)
sortedStringListDecoder fieldName =
    Decode.field fieldName
        (Decode.list
            (Decode.string
                |> Decode.andThen
                    (\s ->
                        if String.length s > 0 then
                            Decode.succeed s

                        else
                            Decode.fail
                                (fieldName ++ " contains empty-string element")
                    )
            )
        )


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


-- ---------------------------------------------------------------------------
-- HeldSetProgress (HELD-SET-PROGRESS-AUTHORITY01)
-- ---------------------------------------------------------------------------


{-| Encode a `HeldSetProgress` to a wire string. Used for diagnostic
transparency in the policy's outbound message (the C14 differential
fixtures assert on the classification tag) and for the `Main.elm`
outbound payload.

Closed wire enum:

  indeterminate                       -- prior = []
  no_progress                         -- prior == current
  passive_accumulation                -- current is strict superset of prior
  contraction_or_membership_shift     -- prior has element not in current
-}
encodeHeldSetProgress : HeldSetProgress -> String
encodeHeldSetProgress p =
    case p of
        Indeterminate ->
            "indeterminate"

        NoProgress ->
            "no_progress"

        PassiveAccumulation ->
            "passive_accumulation"

        ContractionOrMembershipShift ->
            "contraction_or_membership_shift"


{-| Decode a `HeldSetProgress` from a wire string. Used by the
outbound message decoder and by the differential correspondence
fixtures. Unknown tags fail closed (return `Indeterminate` — the
safest of the four classifications; the policy still produces the
correct `Directive` because the classification is only a diagnostic
surface, the authority lives in `Policy.decide`).
-}
decodeHeldSetProgress : String -> HeldSetProgress
decodeHeldSetProgress s =
    case s of
        "indeterminate" ->
            Indeterminate

        "no_progress" ->
            NoProgress

        "passive_accumulation" ->
            PassiveAccumulation

        "contraction_or_membership_shift" ->
            ContractionOrMembershipShift

        _ ->
            -- Closed-enum invariant: unknown tags fall back to
            -- `Indeterminate`. The diagnostic surface should never
            -- see an unknown tag (the encoder is the only writer),
            -- but a defensive fallback protects against a hand-crafted
            -- message. `Indeterminate` is the safe choice because
            -- it releases the directive (it does not STALL).
            Indeterminate