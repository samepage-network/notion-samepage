import createApiMessageHandler from "samepage/backend/createApiMessageHandler";
import applyState from "src/utils/applyState";
import notebookRequestHandler from "src/utils/notebookRequestHandler";
import { Client as NotionClient } from "@notionhq/client";

const message = createApiMessageHandler({
  getDecodeState:
    ({ accessToken }) =>
    (id, state) =>
      applyState(
        id,
        state.$body,
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
