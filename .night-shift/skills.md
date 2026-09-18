# Installed skills

These skills are installed here as committed copies. They are not fetched at run
time: an upstream edit would otherwise change what an unattended run does
without anyone reviewing it, and a network install adds a failure mode at
whatever hour the run wakes.

| Skill | Source | Upstream commit |
|---|---|---|
| `night-shift-worker` | `factoryengineering/skills` | `9d44b2422f9704e49f13ee2cc61b9a0f0737b07d` |
| `refining-issues` | `factoryengineering/skills` | `9d44b2422f9704e49f13ee2cc61b9a0f0737b07d` |
| `degrees-of-freedom` | `michaellperry/skills` | `b1dbdfe374847d5a595b0f2a0066feb684fc5219` |

To take an upstream change, re-copy the skill directory from its source, update
its commit above, and read the diff before you push. Local edits to an installed
skill belong upstream instead, or the next update silently reverts them.
