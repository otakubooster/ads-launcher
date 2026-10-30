import { createFakeGraph } from "./fake-graph";

const port = Number(process.env.FAKE_GRAPH_PORT ?? 4010);
const fake = createFakeGraph();
const url = await fake.listen(port);
console.log(`[fake-graph] listening on ${url} — set META_GRAPH_HOST=${url}; tokens starting with EAAFAKE are valid`);
