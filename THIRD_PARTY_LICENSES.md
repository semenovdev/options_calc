# Third-party licenses

The application intentionally uses only open-source dependencies. No trial, evaluation,
source-available, or commercially licensed UI/charting package is included.

## Runtime dependencies

| Package | License |
| --- | --- |
| Vue | MIT |
| Pinia | MIT |
| Vue Router | MIT |
| Apache ECharts | Apache-2.0 |
| vue-echarts | MIT |
| @lucide/vue | ISC |

Development dependencies use MIT, ISC, or Apache-2.0 licenses. The exact resolved tree is
recorded in `package-lock.json`; it can be audited with `npm query ':attr(license, [MIT ISC Apache-2.0 BSD-2-Clause BSD-3-Clause])'` and `npm audit`.
