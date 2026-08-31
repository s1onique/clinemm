# Adversarial-case inventory — ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01

If the operator / product owner chooses `POLICY_SEMANTICS_DEFECT`
(i.e. ALL + mandatory Seatbelt SHOULD suppress approval for outside
safe R0 reads), these are the cases that the implied policy must
also classify correctly. None of them are mechanical; each is a
privacy / data-authority question that requires an explicit answer.

This is NOT a repair specification. It is the input a future
`…REPAIR01` ACT would need to author if the verdict lands on B.

---

## §1. The benign live specimen (the trigger)

```text
  Command:
    wc -l <inside>/.factory/evidence/.../live/... &&
    cat /etc/profiles/per-user/chistyakov/bin/codium-clinemm

  GATE A: ASK / host_workspace_realpath_authority
  GATE B: PERMITTED  (broad read allow; not in curated credential set)
  Net effect today: user must approve
```

The benign specimen shows what a "successful" auto-approval under
POLICY_B would look like. The hostile specimens below show what
must NOT be auto-approved even under POLICY_B.

---

## §2. Hostile paths (read privacy)

If the operator authorizes "outside reads are fine because Seatbelt contains the process", these paths must STILL be ASK (or DENY) at the data-authority layer.

```text
  /etc/passwd                                uid/user enumeration
  /etc/shadow                                password hashes  (root-only by default)
  /etc/sudoers                               sudo configuration
  /etc/master.passwd                         BSD password DB
  /etc/profiles/per-user/<u>/...             user-scoped profiles
  /private/etc/...                           BSD equivalent paths
  ~/.ssh/id_rsa                              EXPLICIT DENY (CURATED_V1 §3.4)
  ~/.ssh/id_ed25519                          EXPLICIT DENY (CURATED_V1 §3.4)
  ~/.gnupg/private-keys-v1.d/                 EXPLICIT DENY (CURATED_V1 §3.4)
  ~/.ssh/config                              EXPLICIT KEEP_READABLE (privacy leak)
  ~/.ssh/known_hosts                         EXPLICIT KEEP_READABLE (privacy leak)
  ~/.aws/credentials                         DEFER_AUTHENTICATED_DEV_CREDENTIALS
  ~/.aws/config                              DEFER_AUTHENTICATED_DEV_CREDENTIALS
  ~/.kube/config                             DEFER_AUTHENTICATED_DEV_CREDENTIALS
  ~/.docker/config.json                      DEFER_AUTHENTICATED_DEV_CREDENTIALS
  ~/.config/gh/hosts.yml                     DEFER_AUTHENTICATED_DEV_CREDENTIALS
  ~/.bash_history                            shell history (privacy)
  ~/.zsh_history                             shell history (privacy)
  ~/.python_history                          python REPL history
  ~/.mysql_history                           mysql client history
  ~/.psql_history                            psql history
  ~/.netrc                                   legacy credential file
  ~/.pgpass                                  postgres password file
  ~/.my.cnf                                  mysql options file
  ~/.git-credentials                         git credential store
  ~/.gitconfig                               git config (may contain tokens)
  /Users/<other-user>/...                    other users home dirs (cross-tenant)
  /Volumes/<other-volume>/...                other mounted volumes
  /private/var/...                           system paths
```

A POLICY_B implementation that simply trusted Seatbelt containment would auto-approve all of these into model context. That is a **catastrophic data leak**.


---

## §3. Symlink and process-side realpath games

```text
  cat /Users/me/workspace/innocent-looking-link
    -> realpath: /Users/me/.ssh/id_rsa
    GATE B: would actually DENY at kernel layer
            (because Seatbelt rule processing matches the resolved vnode;
             last-match-wins; deny rule is emitted after allow)
    GATE A: realpath escapes workspace root -> ASK
    Net effect: BOTH gates agree this is unsafe.

  find /Users/me/workspace -name *.conf
    -> walks symlinks, realpath-resolves each
    GATE B: same; any hit outside denyReadSubpaths is permitted at SBPL layer
    GATE A: per-file realpath containment; outside -> ASK
    This is fine, but see §4.
```

Note: `cat` resolves symlinks via `realpath` only if the kernel sees the read at the vnode level. Seatbelt matches the vnode, not the path string. So symlink games are caught by BOTH gates — but only because GATE A per-command realpath conformance fails closed.


---


## §4. Two-element arrays mixing inside/outside operands

This is the LIVE 54T24A8CE5 case. The outside operand dominates the verdict under current tests (GATE A step 4 fires before step 7).

```text
  commands: ["wc -l <inside>", "cat <outside>"]

  Under POLICY_A (current default): ASK / host_workspace_realpath_authority
  Under POLICY_B (hypothetical):    ???
```

If POLICY_B says "outside reads are fine when the inside operand is contained", that creates a **smuggling vector**: an attacker (model or dependency) can craft a two-element input where one element is benign-inside and the other is the actual target-outside. The benign element creates a positive witness for "this input has inside content"; the policy treats the input as ALLOW-eligible; the malicious element runs auto-approved.

A defensible POLICY_B implementation must therefore classify the input by **per-command** realpath containment, not by the array-level predicate "at least one operand is inside". The existing per-command infrastructure in `seatbelt-all-workspace-realpath-authority-correction02` already operates per-command. A POLICY_B implementation would need to explicitly enumerate that.


---

## §5. Adversarial commands

```text
  cat <outside-file>                            direct read
  wc -l <outside-file>                          line count (leaks size)
  head -n 1 <outside-file>                      first line (leaks content)
  md5 <outside-file>                            hash (does NOT leak content)
                                                but does leak the file existence and size
  file <outside-file>                           magic-byte sniff (leaks content)
  stat <outside-file>                           metadata (file-read-metadata is allowed
                                                for whole FS at SBPL layer)
  readlink -f <outside>                         realpath (metadata only)
  find / -name pattern 2>/dev/null              walks host FS at SBPL layer; permitted
                                                at SBPL layer; would emit every matching
                                                path to model context
  locate <pattern>                              equivalent (cached DB)
  lsof -p $$                                    open file descriptors of the process
                                                (permits self-introspection)
  env                                           dumps sanitized env (safe env allow-list)
  ls -la /Users/me/.ssh/                        enumerates a credential-adjacent dir
                                                (returns dirents, not file contents)
```

The PRIVACY distinction (`safe to run` vs `safe to emit`) applies to *every* command whose stdout can include outside content. A POLICY_B implementation must distinguish:

```text
  - commands whose stdout can include outside content (cat, head,
    wc, file, find ...): privacy-sensitive; require approval OR
    post-process the output to redact outside content.
  - commands whose stdout is purely inside (chmod inside, git
    status inside): safe to auto-approve.
  - commands whose stdout is path-only metadata (md5, stat,
    readlink): debatable; see §6.
```


---

## §6. The privacy/density tradeoff

A POLICY_B implementation that handles §2-§5 correctly might look like:

```text
  1. classify each command privacy class
     (INSIDE_ONLY, OUTSIDE_CONTENT_LEAK, OUTSIDE_METADATA_LEAK,
      OUTSIDE_DIRECTORY_LEAK, OUTSIDE_BLOCKED)
  2. for INSIDE_ONLY: ALLOW
  3. for OUTSIDE_BLOCKED: DENY (always — credential set etc.)
  4. for OUTSIDE_CONTENT_LEAK: ASK (data-authority layer)
  5. for OUTSIDE_METADATA_LEAK: ASK (debatable; small leaks OK?)
  6. for OUTSIDE_DIRECTORY_LEAK: ASK (dirent enumeration is often
     sufficient for fingerprinting)
```

This is not derivable from the source; it requires product input on each cell.


---

## §7. Network-egress implications

A POLICY_B implementation must also rule on the network posture when outside reads are auto-approved:

```text
  GATE B network default = DENY:
    outside read auto-approved -> contents enter model context only.
    No exfiltration vector.

  GATE B network = ALLOW (with curated credential read deny list):
    outside read auto-approved -> contents could be exfiltrated
    to network by a follow-up command. The CURATED_CREDENTIAL_SET
    deny list does not cover AWS/Kube/Docker/gh config or arbitrary
    host files.
```

POLICY_B should probably NOT enable network=allow when outside reads are auto-approved, unless the credential deny list is expanded.


---

## §8. The real question for the operator / product owner

> Is ClineMM `host_workspace_realpath_authority` intended to be a
> **SECURITY / PRIVACY invariant** (the data-authority boundary
> that the model should never cross), or merely a **SUBSTITUTE FOR
> SANDBOX CONTAINMENT** (a convenience gate that pre-dates Seatbelt
> and is now redundant)?

The answer decides whether 54T24A8CE5 is:

```text
  A. NOT_A_DEFECT_POLICY_EXPECTED     (security/privacy boundary; ASK is correct)
  B. POLICY_SEMANTICS_DEFECT          (substitute; should ALLOW under ALL+Seatbelt)
  C. CAPTURE_INSUFFICIENT             (product intent undocumented)
```

This recon produces the source-tree evidence. The operator / product owner produces the answer.

