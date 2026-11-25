# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Bump `glob` to `^14.0.6` (runtime) and dev dependencies to clear the
  `glob`, `minimatch`, `brace-expansion` and `fast-xml-parser` advisories
  reported by `npm audit` ([#43](https://github.com/ErwanRaulo/sumlyzer/pull/43)).

### Documentation

- Add this changelog, a CI badge and a security section to the README.
- Fix outdated statements in `SECURITY.md` and `CONTRIBUTING.md`.

## [1.4.0] - 2026-09-08

### Added

- `--watch` mode: re-runs changed workspaces and the workspaces that depend
  on them ([#26](https://github.com/ErwanRaulo/sumlyzer/pull/26)).

## [1.3.1]

No release notes, see the [diff](https://github.com/ErwanRaulo/sumlyzer/compare/v1.3.0...v1.3.1).

## [1.3.0] - 2026-09-03

### Added

- `--changed` / `--ref`: only run workspaces with changes, via git diff
  ([#18](https://github.com/ErwanRaulo/sumlyzer/pull/18)).
- Support npm `pre`/`post` lifecycle hooks of the test script
  ([#20](https://github.com/ErwanRaulo/sumlyzer/pull/20)).

### Changed

- Spawn fewer processes per workspace ([#19](https://github.com/ErwanRaulo/sumlyzer/pull/19)).

## [1.2.0] - 2026-08-20

### Changed

- Skip/todo/cancelled counts moved to a footnote; duplicate duration and
  test-count output removed.
- Internal refactor of workspace listing, output capture and run loop.

### Fixed

- README example of sumlyzer's output.

## [1.1.0] - 2026-08-19

### Added

- Resolve `workspaces` glob patterns.
- Clear message when no workspace is eligible.

### Changed

- Runner logic decoupled from `node:test`.
- More reliable skipped-workspace count.

## [1.0.1] - 2026-08-11

### Added

- Own `node:test` reporter; workspaces using a custom reporter are detected.
- All workspaces with an invalid `package.json` are listed at once.

### Changed

- Output read as stream chunks instead of being buffered in memory.

### Fixed

- Child processes are cleaned up properly instead of being killed mid-flight.

## [1.0.0]

No release notes, see the [diff](https://github.com/ErwanRaulo/sumlyzer/compare/v0.6.0...v1.0.0).

## [0.6.0] - 2026-08-05

### Changed

- `--concurrency` is clamped to the OS available parallelism.
- Fewer regex instances and less string splitting when parsing large outputs.

Earlier versions (`0.1.1` to `0.5.3`) have no release notes, see the
[tags](https://github.com/ErwanRaulo/sumlyzer/tags).

[Unreleased]: https://github.com/ErwanRaulo/sumlyzer/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/ErwanRaulo/sumlyzer/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/ErwanRaulo/sumlyzer/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/ErwanRaulo/sumlyzer/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/ErwanRaulo/sumlyzer/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/ErwanRaulo/sumlyzer/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/ErwanRaulo/sumlyzer/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ErwanRaulo/sumlyzer/compare/v0.6.0...v1.0.0
[0.6.0]: https://github.com/ErwanRaulo/sumlyzer/compare/v0.5.3...v0.6.0
