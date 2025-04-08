export const ContentTypeText = "text/plain" as const;
export const ContentTypeJson = "application/json" as const;
export const ContentTypeGraph = "application/x-jinaga-graph-v1" as const;

export type PostContentType = typeof ContentTypeText | typeof ContentTypeJson | typeof ContentTypeGraph;
export type PostAccept = typeof ContentTypeJson | undefined;
