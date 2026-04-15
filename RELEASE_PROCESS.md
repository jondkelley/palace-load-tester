# Release Process

Releases are driven entirely by Git tags. Pushing a tag that matches the version pattern triggers the GitHub Actions [release workflow](.github/workflows/release.yml), which:

1. Stamps the tag version into `package.json`
2. Builds Palace for macOS (arm64), Linux (x64), and Windows (x64)
3. Zips each build and uploads it to `cdist@thepalace.app:/var/www/cdist/`

No manual build steps required — tag and push, the rest is automatic.

---

## Stable releases

Tag directly on `main` after merging all changes for the release.

```bash
git checkout main
git pull

git tag v1.4.0
git push origin v1.4.0
```

Follow [semantic versioning](https://semver.org):

| Change type | Example |
|---|---|
| Bug fixes / patches | `v1.4.0` → `v1.4.1` |
| New features, backwards-compatible | `v1.4.1` → `v1.5.0` |
| Breaking changes | `v1.5.0` → `v2.0.0` |

---

## Beta releases

Tag from `main`, `develop`, or a dedicated `release/x.y.z` branch. Use betas to distribute a build for testing before committing to a stable tag.

```bash
git checkout develop   # or main, or release/1.5.0
git pull

git tag v1.5.0-beta.1
git push origin v1.5.0-beta.1
```

Increment the beta counter for each successive pre-release build:

```
v1.5.0-beta.1
v1.5.0-beta.2
v1.5.0-beta.3
...
v1.5.0          ← stable, once the beta is signed off
```

---

## Alpha releases (optional)

Use alphas for early/unstable builds before a feature is ready for broader beta testing.

```bash
git tag v1.5.0-alpha.1
git push origin v1.5.0-alpha.1
```

Typical progression:

```
v1.5.0-alpha.1
v1.5.0-alpha.2
v1.5.0-beta.1
v1.5.0-beta.2
v1.5.0
```

---

## Artifacts

Each triggered build produces three zip files, named after the tag:

```
Palace-darwin-arm64-v1.5.0-beta.1.zip
Palace-linux-x64-v1.5.0-beta.1.zip
Palace-win32-x64-v1.5.0-beta.1.zip
```

These are uploaded automatically to `/var/www/cdist/` on `thepalace.app`.

---

## Auto-update channel upgrade paths

The app compares the manifest version for the selected channel against the currently installed version. It never downgrades — an update is only offered when the manifest version is strictly greater.

| Installed version | Channel selected | Manifest has | Result |
|---|---|---|---|
| `0.1.9-alpha.5` | beta | `0.1.10-beta.5` | Update offered |
| `0.1.9-alpha.5` | beta | `0.0.1-beta.1` | No update (manifest is older) |
| `0.1.9-alpha.5` | beta | `0.1.9-beta.3` | Update offered (`beta` sorts after `alpha`) |
| `0.1.9-alpha.5` | stable | `0.1.9` | Update offered (stable beats any pre-release on same base) |
| `0.1.9-alpha.5` | stable | `0.1.8` | No update (installed is newer than latest stable) |
| `0.1.10-beta.3` | alpha | `0.1.10-alpha.5` | No update (no downgrades) |

---

## Deleting a bad tag

If you pushed a tag by mistake, delete it locally and remotely before re-tagging:

```bash
git tag -d v1.5.0-beta.1
git push origin --delete v1.5.0-beta.1
```

Then re-tag the correct commit and push again.
