# Congratulations

This static site celebrates a learner when `kakomonn-reader` reports that
`dueCardsCompleted` is `true`. Each visit selects one installed experience with
cryptographically unbiased randomness.

The query string must contain exactly `site`, `date`, and
`dueCardsCompleted=true`. Invalid or incomplete celebration data is rejected.

Deployable experience snapshots live in `experiences/` and are listed in
`celebrations.json`. The locally cloned design references in `upstreams/` are
ignored by the parent repository and are not part of the production build.

## Acknowledgements

Congratulations is built on a wonderful collection of open-source design
experiences created by [bswxyz](https://github.com/bswxyz). A heartfelt thank
you for sharing this work and making these celebrations possible.

| Experience | Source repository |
| --- | --- |
| Aperture Lab | [bswxyz/aperture-lab](https://github.com/bswxyz/aperture-lab) |
| Conche | [bswxyz/conche](https://github.com/bswxyz/conche) |
| Driftline Ocean | [bswxyz/driftline-ocean](https://github.com/bswxyz/driftline-ocean) |
| Fathom | [bswxyz/fathom](https://github.com/bswxyz/fathom) |
| Chroma | [bswxyz/formwork-chroma](https://github.com/bswxyz/formwork-chroma) |
| Contour | [bswxyz/formwork-contour](https://github.com/bswxyz/formwork-contour) |
| Heliodon | [bswxyz/formwork-heliodon](https://github.com/bswxyz/formwork-heliodon) |
| Isometria | [bswxyz/formwork-isometria](https://github.com/bswxyz/formwork-isometria) |
| Meridian | [bswxyz/formwork-meridian](https://github.com/bswxyz/formwork-meridian) |
| Nebula Drift | [bswxyz/formwork-nebula](https://github.com/bswxyz/formwork-nebula) |
| Neon Sprawl | [bswxyz/formwork-neon](https://github.com/bswxyz/formwork-neon) |
| Glyphica | [bswxyz/glyphica](https://github.com/bswxyz/glyphica) |
| Halcyon Ring | [bswxyz/halcyon-ring](https://github.com/bswxyz/halcyon-ring) |
| Halfstep | [bswxyz/halfstep](https://github.com/bswxyz/halfstep) |
| Northbound | [bswxyz/northbound-ev](https://github.com/bswxyz/northbound-ev) |
| Perigee | [bswxyz/perigee-astro](https://github.com/bswxyz/perigee-astro) |

The snapshots are adapted under the MIT License. Copyright and license notices
are preserved in each experience's `LICENSE` file.

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
