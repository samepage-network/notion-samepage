import createApiMessageHandler from "samepage/backend/createApiMessageHandler";
import decodeState from "src/utils/decodeState";
import notebookRequestHandler from "src/utils/notebookRequestHandler";
import { Client as NotionClient } from "@notionhq/client";

const message = createApiMessageHandler({
  getDecodeState:
    ({ accessToken }) =>
    (id, state) =>
      decodeState(
        id,
        state,
        new NotionClient({
          auth: accessToken,
        })
      ),
  getNotebookRequestHandler: ({ accessToken }) =>
    notebookRequestHandler(
      new NotionClient({
        auth: accessToken,
      })
    ),
  getNotebookResponseHandler: () => async () => {},
});

export default message;
