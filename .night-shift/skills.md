# Installed skills

These skills are installed here as committed copies. They are not fetched at run
time: an upstream edit would otherwise change what an unattended run does
without anyone reviewing it, and a network install adds a failure mode at
whatever hour the run wakes.

| Skill | Source | Upstream commit |
|---|---|---|
| `night-shift-worker` | `factoryengineering/skills` | `b4f73c29cceae5740c06359e0788c8c40db91d59` |
| `refining-issues` | `factoryengineering/skills` | `b4f73c29cceae5740c06359e0788c8c40db91d59` |
| `degrees-of-freedom` | `michaellperry/skills` | `f528e6bffd7f8660be360f0b302c0a10fecf9acd` |

To take an upstream change, re-copy the skill directory from its source, update
its commit above, and read the diff before you push. Local edits to an installed
skill belong upstream instead, or the next update silently reverts them.
