# Installed skills

These skills are installed here as committed copies. They are not fetched at run
time: an upstream edit would otherwise change what an unattended run does
without anyone reviewing it, and a network install adds a failure mode at
whatever hour the run wakes.

| Skill | Source | Upstream commit |
|---|---|---|
| `night-shift-worker` | `factoryengineering/skills` | `cb95c83cebec95a0d7871ac2b27dc9779c064f20` |
| `refining-issues` | `factoryengineering/skills` | `cb95c83cebec95a0d7871ac2b27dc9779c064f20` |
| `degrees-of-freedom` | `michaellperry/skills` | `f528e6bffd7f8660be360f0b302c0a10fecf9acd` |

To take an upstream change, re-copy the skill directory from its source, update
its commit above, and read the diff before you push. Local edits to an installed
skill belong upstream instead, or the next update silently reverts them.
