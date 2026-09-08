# Installed night-shift skills

The night-shift protocol is published in `factoryengineering/skills` and
installed here as a committed copy. It is not fetched at run time: an upstream
edit would otherwise change what an unattended run does without anyone
reviewing it, and a network install adds a failure mode at whatever hour the
run wakes.

| Skill | Upstream commit |
|---|---|
| `night-shift-worker` | `cc7900f2162c812a2ebe441c50f0ffdb15f4ad0b` |

To take an upstream change, re-copy the skill directory, update the commit
above, and read the diff before you push. Local edits to an installed skill
belong upstream instead, or the next update silently reverts them.
