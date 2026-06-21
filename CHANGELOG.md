# Changelog

## [3.19.2](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.19.1...v3.19.2) (2026-06-21)


### Bug Fixes

* improve owner detection for CARREFOUR PROPERTY GESTION letterhead format ([#68](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/68)) ([253ab3d](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/253ab3d2aeed726ee98c1c637d955afe1e7e1b77))

## [3.19.1](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.19.0...v3.19.1) (2026-06-21)


### Bug Fixes

* prevent false positives in owner extraction from accounting tables ([#65](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/65)) ([1ec25a1](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/1ec25a1095f318b149354f39005429329dbe66a1))

## [3.19.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.18.0...v3.19.0) (2026-06-21)


### Features

* configurable performance level (OCR worker pool + file concurrency) ([#63](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/63)) ([37b361d](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/37b361dd18ad7d4bbd701ba003f8957d10529190))

## [3.18.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.17.0...v3.18.0) (2026-06-21)


### Features

* ocr rotation dedup concurrency pool ([#61](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/61)) ([028f056](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/028f056dab2f980a2c9302e0e3387ddb86d3540a))

## [3.17.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.16.1...v3.17.0) (2026-06-21)


### Features

* add toggle buttons ([#59](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/59)) ([fd1e6fc](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/fd1e6fc201f267f20e536f3754114014f60b3d62))

## [3.16.1](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.16.0...v3.16.1) (2026-06-20)


### Bug Fixes

* improve ZoomThumb positioning for different rotation angles ([#57](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/57)) ([76d4dde](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/76d4dde11eb398367653c1d21f75b4b1c3daab79))

## [3.16.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.15.0...v3.16.0) (2026-06-20)


### Features

* enhance OCR functionality with confidence scoring and rotation detection improvements ([#55](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/55)) ([ecdf04f](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/ecdf04faa9e70efce47f1011c828af2e058e39d3))

## [3.15.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.14.0...v3.15.0) (2026-06-20)


### Features

* increase thumbnail zoom dimensions to enhance image clarity ([#53](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/53)) ([f1e6ec3](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/f1e6ec399cf885797d1966b2d22b70e727b20d56))

## [3.14.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.13.0...v3.14.0) (2026-06-20)


### Features

* implement auto-rotation detection and correction for PDF pages ([#51](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/51)) ([07fee71](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/07fee71fd68081f7cfd4cf26c0115597540b07b9))

## [3.13.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.12.4...v3.13.0) (2026-06-14)


### Features

* implement support for multiple PPTX files with enhanced data model and UI updates ([#49](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/49)) ([b2dd399](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/b2dd399c577fa5ad91b21dbbe628cf22a20bb4c5))

## [3.12.4](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.12.3...v3.12.4) (2026-06-14)


### Bug Fixes

* disable TopBar buttons during extracting status ([#45](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/45)) ([0a64b41](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/0a64b41311ccfd9257268dfa32718f293c8cce3f))
* owner detections with ocr ([#47](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/47)) ([78e3d16](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/78e3d16d109f98b646a7fe53df7c09f8e374c805))

## [3.12.3](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.12.2...v3.12.3) (2026-06-07)


### Bug Fixes

* detect owners in mixed-orientation PDFs, add multi-owner confirmation dialog ([#43](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/43)) ([c48983a](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/c48983a2cf9a48cd6a8a5d59d308d7b65bca37bf))

## [3.12.2](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.12.1...v3.12.2) (2026-06-02)


### Bug Fixes

* make PowerPoint Visible=False non-fatal on restricted Windows environments ([#41](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/41)) ([536c212](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/536c21261c1b02a4e4422e365e6cf68afef4bb66))

## [3.12.1](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.12.0...v3.12.1) (2026-06-02)


### Bug Fixes

* comprehensive DISP_E_EXCEPTION fix for Presentations.Open on Windows ([#39](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/39)) ([b1abac2](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/b1abac29caad8768556c974cfaeb8d8154d80108))

## [3.12.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.11.0...v3.12.0) (2026-06-02)


### Features

* generate multiple pdf when multiple owner ([#36](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/36)) ([baf7889](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/baf788928c10f887996e8a36097e1af62f64eefe))


### Bug Fixes

* resolve DISP_E_EXCEPTION (0x80020009) on Presentations.Open ([#37](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/37)) ([a61c66e](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/a61c66ec0f81cab8463a7e2813d27ca1dbb3e482))

## [3.11.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.10.0...v3.11.0) (2026-04-22)


### Features

* generate one PDF per owner with directory picker and snake_casenaming ([#34](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/34)) ([eb66e1a](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/eb66e1a677600c750830cf05b392b7a0f4766101))

## [3.10.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.9.1...v3.10.0) (2026-04-22)


### Features

* detect Copropriétaire owners from landscape PDFs ([#31](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/31)) ([0a30698](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/0a306980a4ca8c8551e2f45ae4b36e9800984166))

## [3.9.1](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.9.0...v3.9.1) (2026-04-12)


### Bug Fixes

* add sync script for Tauri plugin version synchronization ([#29](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/29)) ([3545e13](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/3545e13976565cf21d4d7b4c4ded54548c314da7))

## [3.9.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.8.0...v3.9.0) (2026-04-12)


### Features

* add unit tests for useMergeStore and related utilities ([#27](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/27)) ([8ca1279](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/8ca1279a444fbabc566ba7fc1ea74aa8f04edccf))

## [3.8.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.7.0...v3.8.0) (2026-04-05)


### Features

* add application version information ([#25](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/25)) ([f8f1f55](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/f8f1f55063b2c33e1a2cfd67c04cffcbebeba966))

## [3.7.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.6.1...v3.7.0) (2026-04-05)


### Features

* implement dark and light mode themes with context and CSS variables ([#23](https://github.com/GuillaumeElhadi/pdf_pptx_merger/issues/23)) ([663ecd5](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/663ecd57a8165ab0c8f6bbffa0a1663a11a14371))

## [3.6.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.5.0...v3.6.0) (2026-04-04)


### Features

* enable manual triggering of release workflow with workflow_dispatch ([f2f0bda](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/f2f0bda8e45dfc42a3a6ef5185dc11df26ce249f))
* enhance release workflow with manual trigger and input for release ID ([93a740a](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/93a740a5dc713e37c67a3575063f3e7620dd6455))

## [3.6.0](https://github.com/GuillaumeElhadi/pdf_pptx_merger/compare/v3.5.0...v3.6.0) (2026-04-04)


### Features

* enable manual triggering of release workflow with workflow_dispatch ([f2f0bda](https://github.com/GuillaumeElhadi/pdf_pptx_merger/commit/f2f0bda8e45dfc42a3a6ef5185dc11df26ce249f))
