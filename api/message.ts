import createBackendClientHandler from "samepage/backend/createBackendClientHandler";
import applyState from "src/utils/applyState";
import notebookRequestHandler from "src/utils/notebookRequestHandler";
import { Client as NotionClient } from "@notionhq/client";

const message = (args: Record<string, unknown>) => {
  const notionClient = new NotionClient({
    // createBackendClientHandler doesn't pass this in and it should.
    auth: args.accessToken as string,
  });
  return createBackendClientHandler({
    applyState: (id, state) => applyState(id, state, notionClient),
    notebookRequestHandler: notebookRequestHandler(notionClient),
    notebookResponseHandler: async () => {},
  })(args);
};

export default message;
