import { EncodeState } from "samepage/internal/types";
import toAtJson, { blockContentToAtJson } from "./toAtJson";
import toUuid from "./toUuid";
import { Client as NotionClient } from "@notionhq/client";

const encodeState = async ({
  notebookPageId,
  notebookUuid,
  notionClient,
}: {
  notebookPageId: string;
  notebookUuid: string;
  notionClient: NotionClient;
}): ReturnType<EncodeState> => {
  const $body = await toAtJson({
    block_id: toUuid(notebookPageId),
    notebookUuid,
    notionClient,
  });
  const properties = await notionClient.pages
    .retrieve({ page_id: notebookPageId })
    .then((page) => {
      if (!("properties" in page)) return {};
      const properties = Object.entries(page.properties).map(([k, v]) => {
        if (v.type === "title") {
          return [
            "$title",
            blockContentToAtJson({
              rich_text: v.title,
              notebookUuid,
            }),
          ];
        }
        return [k, { content: "", annotations: [] }];
      });
      return Object.fromEntries(properties);
    });
  return { $body, ...properties };
};

export default encodeState;
