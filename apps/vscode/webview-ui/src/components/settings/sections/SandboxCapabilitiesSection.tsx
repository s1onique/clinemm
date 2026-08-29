/**
 * ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01
 *
 * Settings UI surface for the ClineMM sandbox capability controls.
 *
 * Predecessor recon:
 *   `.factory/acts/ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01.md`
 *   and its `local-settings-seam-map.md` / `proposed-clinemm-settings-
 *   contract.md` evidence.
 *
 * This section exposes TWO persisted capability toggles that bind
 * directly to the existing production runtime-capability selectors:
 *
 *   1. "Allow outbound network"
 *        Setting key:  clinemmSafeYoloAllowNetwork
 *        Persisted:    boolean (default false = deny, the pre-ACT
 *                      behaviour; persisted `true` means enable
 *                      network egress)
 *        Runtime:      apps/vscode/src/sdk/sandbox-policy.ts →
 *                      SandboxNetwork 'allow' / 'deny' inside the
 *                      CommandCapability built by
 *                      buildExperimentalReconCapability.
 *
 *   2. "Allow SSH agent authentication"
 *        Setting key:  clinemmSafeYoloAllowSshAgent
 *        Persisted:    boolean (default false = deny = no agent
 *                      authority; persisted `true` opts into the
 *                      existing sshAuthenticationAuthority.mode =
 *                      "agent" branch)
 *        Runtime:      SshAuthenticationAuthority { mode: "agent" }
 *                      in the CommandCapability field, which the
 *                      Seatbelt backend already wires to the
 *                      SSH_AUTH_SOCK path-literal AF_UNIX rule
 *                      (see ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY
 *                      -IMPLEMENTATION01).
 *
 * Help text per the recon's proposed contract: concise, accurate,
 * and explicit about what changes when the toggle is enabled.
 * No upstream copy; no new dependency; no architectural redesign.
 *
 * The component reads authoritative state through useExtensionState
 * (already populated by getStateToPostToWebview) and writes through
 * the canonical updateSetting helper. No diagnostic side effects in
 * functional updaters; no auto-approve / YOLO mutation.
 */

import { memo, type ReactNode } from "react"
import { Switch } from "@/components/ui/switch"
import { useExtensionState } from "@/context/ExtensionStateContext"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface SandboxCapabilitiesRowProps {
	checked: boolean
	onChange: (next: boolean) => void
	label: string
	description: ReactNode
}

const SandboxRow = memo(({ checked, onChange, label, description }: SandboxCapabilitiesRowProps) => (
	<div className="flex flex-col items-start justify-between gap-1 py-3 w-full">
		<div className="flex w-full items-center justify-between gap-3">
			<span className="text-sm text-foreground font-medium">{label}</span>
			<Switch
				aria-label={label}
				checked={checked}
				className="shrink-0"
				id={label}
				onCheckedChange={onChange}
				size="lg"
			/>
		</div>
		<div className="text-xs text-description pr-10">{description}</div>
	</div>
))

interface SandboxCapabilitiesSectionProps {
	renderSectionHeader: (tabId: string) => ReactNode
}

const SandboxCapabilitiesSection = ({ renderSectionHeader }: SandboxCapabilitiesSectionProps) => {
	const {
		clinemmSafeYoloAllowNetwork,
		clinemmSafeYoloAllowSshAgent,
	} = useExtensionState()

	return (
		<div>
			{renderSectionHeader("sandbox")}
			<Section>
				<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">
					Sandbox
				</div>
				<div className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50">
					<p className="text-sm text-muted-foreground pt-3 pb-2">
						ClineMM runs commands through the Seatbelt sandbox on macOS. The
						settings below opt into narrowly scoped host capabilities. Each
						toggle is independent: enabling one does not enable the others.
						These settings overwrite the corresponding
						CLINEMM_SAFE_YOLO_* environment variables when persisted.
					</p>

					<SandboxRow
						checked={!!clinemmSafeYoloAllowNetwork}
						description={
							<>
								Permits sandboxed commands to make outbound network connections.
								Without this, the sandbox blocks all network egress. Enabling
								this activates the network-open credential read guard (the
								dangerous capability triggers the curated deny list).
							</>
						}
						label="Allow outbound network"
						onChange={(next) =>
							updateSetting("clinemmSafeYoloAllowNetwork", next)
						}
					/>

					<SandboxRow
						checked={!!clinemmSafeYoloAllowSshAgent}
						description={
							<>
								Reintroduces the <code>SSH_AUTH_SOCK</code> socket into
								sandboxed commands so they can talk to your ssh-agent. Raw
								SSH private keys (e.g. <code>~/.ssh/id_rsa</code>) remain
								unreadable; only the agent socket is granted AF_UNIX connect
								authority.
							</>
						}
						label="Allow SSH agent authentication"
						onChange={(next) =>
							updateSetting("clinemmSafeYoloAllowSshAgent", next)
						}
					/>
				</div>
			</Section>
		</div>
	)
}

export default memo(SandboxCapabilitiesSection)
