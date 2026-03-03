# Release Runbook

## Support Matrix

- macOS: arm64, 15.5+
- Windows: x64
- Distribution: single ZXP with both native payloads

## Required Secrets (GitHub Actions)

### macOS signing/notarization

- `MAC_CODESIGN_IDENTITY`  
  Developer ID Application identity, for example: `Developer ID Application: Your Company (TEAMID)`.
- `MAC_NOTARY_KEYCHAIN_PROFILE`  
  Preferred notarytool auth profile on runner keychain.

Alternative (if no keychain profile):

- `MAC_NOTARY_APPLE_ID`
- `MAC_NOTARY_TEAM_ID`
- `MAC_NOTARY_APP_PASSWORD`

### Windows signing

- `WIN_SIGN_PFX_BASE64`  
  Base64-encoded `.pfx` certificate.
- `WIN_SIGN_PFX_PASSWORD`  
  PFX password.
- `WIN_TIMESTAMP_URL`  
  RFC3161 timestamp URL (defaults to Digicert if not set).

## Release Pipeline Summary

1. Build native payload on macOS.
2. Stage `face_pipeline.app` and verify app closure.
3. Sign app internals, then sign/notarize/staple `face_pipeline.app`.
4. Run Gatekeeper distribution verification (`yarn verify:mac:dist`).
5. Build native payload on Windows.
6. Stage runtime DLL closure and verify Windows payload.
7. Sign Windows payload.
8. Assemble mac app + Windows payloads into `src/bin`.
9. Verify cross-platform bundle integrity (`yarn verify:native:all`).
10. Build ZXP and publish release assets + checksums.

## Operational Checklist

- Confirm model files are present (`scrfd` and `rf-detr`).
- Confirm `windows-runtime-manifest.json` is included in staged Windows artifacts.
- Confirm mac payload is app-only (`src/bin/face_pipeline.app`) with no legacy `src/bin/face_pipeline` or `src/bin/lib`.
- Confirm app metadata exists (`src/bin/face_pipeline.app/Contents/Info.plist` and `PkgInfo`).
- Confirm mac payload passes `codesign --verify --deep --strict src/bin/face_pipeline.app`.
- Confirm notarization status is `Accepted` and app is stapled (`xcrun stapler validate src/bin/face_pipeline.app`).
- Confirm Gatekeeper accepts the app (`spctl --assess --type execute --verbose=4 src/bin/face_pipeline.app`).
- Confirm signed Windows files pass `signtool verify /pa`.
- Confirm CI artifact checksums are published with release assets.

## Certificate Rotation

- Rotate Apple and Windows signing material at least annually.
- Update GitHub secrets and perform a dry-run tag release on a pre-release tag.
- Keep previous cert material available until old releases are no longer distributed.

## Failure Recovery

- **Notarization failure:** inspect notarytool logs, fix signing/entitlements mismatch, rerun tag.
- **Windows signing failure:** validate PFX/password and timestamp service availability.
- **Missing native files in package:** rerun with artifact inspection and `yarn verify:native:all`.
- **Runtime load errors on user machines:** inspect mac app Frameworks linkage (`otool -L src/bin/face_pipeline.app/Contents/MacOS/face_pipeline`) and Windows manifest closure.
