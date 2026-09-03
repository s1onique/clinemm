# 01 — settings-section composition contract

`renderSectionHeader` ownership and call-site wiring in
`apps/vscode/webview-ui/src/components/settings/`.

## 1. SettingsView owns the callback

`SettingsView.tsx:121-135` declares the helper OUTSIDE the
component body so identity is stable across renders:

```tsx
const renderSectionHeader = (tabId: string) => {
    const tab = SETTINGS_TABS.find((t) => t.id === tabId)
    if (!tab) return null
    return (
        <SectionHeader>
            <div className="flex items-center gap-2">
                <tab.icon className="w-4" />
                <div>{tab.headerText}</div>
            </div>
        </SectionHeader>
    )
}
```

It performs an exact-lookup on `SETTINGS_TABS`; unknown tab ids
return `null` (intentional — sibling spec files test this exact
shape via the "Sandbox & Capabilities section header" lock test).

## 2. SettingsView supplies the callback to the active tab

`SettingsView.tsx:257-276` builds `ActiveContent` that spreads
the active tab's component along with a `props` bag that ALWAYS
contains `renderSectionHeader`:

```tsx
const props: any = { renderSectionHeader }
if (activeTab === "debug") props.onResetState = handleResetState
else if (activeTab === "about") { props.version = version; ... }
else if (activeTab === "api-config") props.initialModelTab = ...
return <Component {...props} />
```

This works for every single-component tab (general, features,
terminal, remote-config, about, debug, api-config) because the
spread lands directly on the section.

## 3. The sandbox tab is the exception

`SettingsView.tsx:139-165` builds `TAB_CONTENT_MAP` with the
sandbox tab mapped to a FRAGMENT factory:

```tsx
sandbox: () => (
    <>
        <SandboxCapabilitiesSection renderSectionHeader={renderSectionHeader} />
        <TemporaryExternalPathsSection renderSectionHeader={renderSectionHeader} />
    </>
),
```

The factory's outer function takes no props; the spread at
`ActiveContent` cannot reach either inner section. Each section
must therefore receive `renderSectionHeader` directly at its JSX
call site — which is exactly what lines 159-160 do post-repair.

Pre-repair (commit ad8f3094c6) both sections were rendered as
`<SandboxCapabilitiesSection />` and `<TemporaryExternalPathsSection />`,
each receiving `{}`. Because both interfaces declare the prop as
required, TS2741 fired twice in the webview tsc build.

## 4. Composition contract table

Per ACT §4 requirements:

| Component                     | Declares `renderSectionHeader`? | Uses it? | Current call site passes it? |
| ----------------------------- | ------------------------------: | -------: | ---------------------------: |
| AboutSection                  |                             yes |      yes | via spread (line 265)        |
| DebugSection                  |                             yes |      yes | via spread (line 265)        |
| GeneralSettingsSection        |                             yes |      yes | via spread (line 265)        |
| FeatureSettingsSection        |                             yes |      yes | via spread (line 265)        |
| TerminalSettingsSection       |                             yes |      yes | via spread (line 265)        |
| RemoteConfigSection           |                             yes |      yes | via spread (line 265)        |
| SandboxCapabilitiesSection    |                             yes |      yes | explicit (line 159, post-repair) |
| TemporaryExternalPathsSection |                             yes |      yes | explicit (line 160, post-repair) |

**CONTRACT = PASS_PROP** — every consumer section calls
`renderSectionHeader(tabId)` and declares it as a required prop.

## 5. Type-level proof — required, not optional

```text
SandboxCapabilitiesSection.tsx:77-79
interface SandboxCapabilitiesSectionProps {
    renderSectionHeader: (tabId: string) => ReactNode   ← required
}

TemporaryExternalPathsSection.tsx:25-27
interface TemporaryExternalPathsSectionProps {
    renderSectionHeader: (tabId: string) => ReactNode   ← required
}
```

Each spec file proves the same at runtime — components are
exercised in isolation with the prop explicitly supplied:

- `SandboxCapabilitiesSection.spec.tsx:59` — `<SandboxCapabilitiesSection renderSectionHeader={() => null} />`
- `SandboxCapabilitiesSection.spec.tsx:113-135` — §P0 lock test verifies `renderSectionHeader("sandbox")` is invoked exactly once with the canonical tab id (regression gate)
- `TemporaryExternalPathsSection.spec.tsx:69` — `<TemporaryExternalPathsSection renderSectionHeader={() => null} />`

## 6. Why both sections are required (not just SandboxCapabilities)

`SandboxCapabilitiesSection` was already present at `ad8f3094c6`
and was originally wired via a different code path that has
since been refactored. The post-refactor `TAB_CONTENT_MAP`
factory loses the spread reach, so the sandbox section ALSO
became unwired at the new composition site.

`TemporaryExternalPathsSection` was newly added in the same
factory body (this ACT's parent — `TEMPORARY-EXTERNAL-PATH-AUTHORITY01`).
It mirrors the sandbox section's contract intentionally; both
sections occupy the same tab because they are both bounded
escape-hatches for the host.

The two missing props are NOT independent defects — they are a
single call-site defect at the sandbox tab's two-element
fragment, where the parent factory's spread can't forward a prop
to two siblings.

## 7. Verdict

CLASS = **A / CALL_SITE_WIRING_MISSING**

The composition contract is correctly "SettingsView owns the
callback, each section receives it directly". The wiring at the
sandbox tab was the latent defect. CORRECTION07's bounded repair
adds the two missing JSX props at lines 159-160.