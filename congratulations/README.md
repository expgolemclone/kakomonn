# Congratulations

This static site celebrates a learner when `kakomonn-reader` reports that
`dueCardsCompleted` is `true`. Each visit selects one installed experience with
cryptographically unbiased randomness.

The query string must contain exactly `site`, `date`, and
`dueCardsCompleted=true`. Invalid or incomplete celebration data is rejected.

Deployable experience snapshots live in `experiences/` and are listed in
`celebrations.json`. The locally cloned design references in `upstreams/` are
ignored by the parent repository and are not part of the production build.

## Development and testing

Run the complete local build and browser suite from the repository root.

```bash
npm run test:congratulations
```

The production URL is
`https://kakomonn-congratulations.kakomonn.workers.dev/`. Deployment and the
production browser checks are contained in one command.

```bash
npm run deploy:congratulations
```
