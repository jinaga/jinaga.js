import { writeFeedVectors } from "./generate";

/**
 * `npm run vectors -- <outdir>`
 *
 * Writes the feed vectors of every case in `feed-cases.ts`. The output is not
 * committed here: a consumer runs this at the jinaga.js commit it pins, and
 * records that commit beside its copy.
 */

const outDirectory = process.argv[2];
if (!outDirectory) {
    process.stderr.write("Usage: npm run vectors -- <outdir>\n");
    process.exit(1);
}

const paths = writeFeedVectors(outDirectory);
process.stdout.write(`Wrote ${paths.length} feed vectors to ${outDirectory}\n`);
