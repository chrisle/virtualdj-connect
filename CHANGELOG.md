# Changelog

## Unreleased

- fix: tracks the DJ rehearses in Sandbox mode no longer get published as now
  playing (thanks @m1ng)
- docs: document sandbox handling and link the related DJ connector libraries

## v1.1.0

- fix(ci): publish no longer fails when several connect repos release together
- ci: publish virtualdj-connect to npm on push to main
- test: align virtualdj-connect track emit assertions with current payload shape
- test: remove broken duplicate test files left from initial scaffolding
- fix: read VirtualDJ file paths and on-air state correctly so artwork
  extraction works
- feat: surface VirtualDJ is_audible as isOnAir on the payload
- feat: pull album/genre/key/bpm/duration/deck from Network Control
- feat: add Network Control Plugin client for lower-latency track capture
- feat: initial virtualdj-connect package
