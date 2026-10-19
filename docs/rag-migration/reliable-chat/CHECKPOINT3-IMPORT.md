# Checkpoint 3 import — 18 October 2026

Imported from dearpolicy-death-journey-checkpoint-3.tgz (SHA-256 531784e2256c0a4a21c9dd389e9fe52176ad2829234b495c75fc13be04cacc2d) onto main at e3109bb523da30cbaf0cac5aa90c35b751db495b.

All 30 uploaded files passed their SHA-256 and Git blob manifest checks before import. The 14 baseline blobs listed in the bundle match this main commit.

One import correction: the uploaded package.json omitted main's existing rag2:live-ledger-test script. This import preserves it and adds reliable-chat:death-journey-test. The other 29 files are unchanged from the supplied manifest. No dependency, auth, migration or environment change is introduced by the import correction.

The three estimated production-UI costs supplied with the bundle are appended once to the existing ledger. The 50 prior entries and the US$0.15 open trial reservation are unchanged. Total estimated spend is US$0.48457720; unreserved allowance is US$0.36542280 of US$1.00. These are application estimates, not provider-billed totals. Unknown commit fields in the supplied historical entries remain unknown.

## Verification provenance

The bundle contains Claude's retained local scripted-model results: typecheck and build pass; 46/47 suites pass, with rag2:s52-replay failing 11/12 as reported on baseline; final death-journey browser rerun passes 3/3 after the fixture edit. The wider regression and browser runs predate the final fixture edit. This importing session verified hashes, baseline blobs, package script preservation and ledger arithmetic, and reviewed the patch. It has not independently rerun those application suites, used the paid model, or tested the actual library.

The paid batch remains pending. Freeze this branch's committed candidate in the existing authorised workbench, verify its manifest, and run the four pre-registered attempts once within the US$0.05 batch cap and current unreserved allowance. Keep every attempt and append its spend through the existing guard. Do not merge or deploy on the strength of this import.

## Review limitations

The fallback's event-family matching is a bounded heuristic, not a general interpretation of every policy definition. Repeated-search compaction treats a passage with at least half its span already seen as a repeat, which needs scrutiny for partially overlapping conditions. Source and lifecycle checks still need the retained negative controls on the committed candidate. The saved phase trace is copied before saveMs is assigned, so it does not prove persistence latency. Remote-database latency and real-model tool choice remain unverified.
