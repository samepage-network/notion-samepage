import type { NotebookRequestHandler } from "samepage/internal/types";
import toAtJson from "./toAtJson";
import toUuid from "./toUuid";
import { Client as NotionClient } from "@notionhq/client";

const notebookRequestHandler = (notionClient: NotionClient): NotebookRequestHandler => async (request) => {
  if (Array.isArray(request.conditions)) {
    // Convert SamePageQueryArgs to Notion Requests
    //
    // const result = samePageQueryArgsSchema.safeParse(request);
    // if (!result.success) return;
    // const datalogQuery = getDatalogQuery(result.data);
    // const query = compileDatalog(datalogQuery);
    // const results = (window.roamAlphaAPI.data.fast.q(query) as [json][]).map(
    //   (r) => r[0]
    // );
    // sendResponse({
    //   results,
    // });
  } else if (
    typeof request.notebookPageId === "string" &&
    typeof request.notebookUuid === "string"
  ) {
    return toAtJson({
      block_id: toUuid(request.notebookPageId),
      notebookUuid: request.notebookUuid,
      notionClient,
    });
  }
};

export default notebookRequestHandler;
