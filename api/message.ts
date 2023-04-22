import createBackendClientHandler from "samepage/backend/createBackendClientHandler";
import applyState from "src/utils/applyState";
import notebookRequestHandler from "src/utils/notebookRequestHandler";
import { Client as NotionClient } from "@notionhq/client";

const message = (args: Record<string, unknown>) => {
  const notionClient = new NotionClient({
    // createBackendClientHandler doesn't pass this in and it should.
    // @ts-ignore
    auth: args.credentials.accessToken as string,
  });
  return createBackendClientHandler({
    decodeState: (id, state) => applyState(id, state.$body, notionClient),
    notebookRequestHandler: notebookRequestHandler(notionClient),
    notebookResponseHandler: async () => {},
  })(args);
};

export default message;
