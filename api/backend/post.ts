import createApiBackendPostHandler from "samepage/backend/createApiBackendPostHandler";
import { Client as NotionClient } from "@notionhq/client";
import applyState, { getRichTextItemsRequest } from "src/utils/applyState";
import {
  CreatePageParameters,
  DatabaseObjectResponse,
  PageObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints";
import encodeState from "src/utils/encodeState";

const backend = createApiBackendPostHandler({
  getDecodeState:
    ({ accessToken }) =>
    (id, state) =>
      applyState(
        id,
        state.$body,
        new NotionClient({
          auth: accessToken,
        })
      ).then(() => ({ success: true })),
  getEncodeState:
    ({ accessToken, notebookUuid }) =>
    (notebookPageId) =>
      encodeState({
        notebookPageId,
        notebookUuid,
        notionClient: new NotionClient({
          auth: accessToken,
        }),
      }),
  getEnsurePageByTitle:
    ({ accessToken }) =>
    async (title, path) => {
      const notionClient = new NotionClient({
        auth: accessToken,
      });
      const pages = await notionClient.search({
        query: title.content,
        filter: {
          property: "object",
          value: "page",
        },
      });
      const existingPage = pages.results.find((p) => {
        if (!("properties" in p)) return false;
        const property = Object.values(p.properties).find(
          (
            prop
          ): prop is {
            type: "title";
            title: Array<RichTextItemResponse>;
            id: string;
          } => prop.type === "title"
        );
        if (!property) return false;
        // TODO convert title to atJson and compare
        return property.title[0].plain_text === title.content;
      });
      if (existingPage) {
        return { notebookPageId: existingPage.id, preExisting: true };
      }
      if (!path)
        throw new Error(
          `No existing page found and no path specified to create one.`
        );
      const properties: CreatePageParameters["properties"] = {
        title: {
          title: getRichTextItemsRequest({
            text: title.content,
            annotation: {
              start: 0,
              end: title.content.length,
              annotations: title.annotations,
            },
          }),
        },
      };
      if (/^\/?[a-f0-9]{32}$/.test(path)) {
        return notionClient.pages
          .create({
            parent: {
              database_id: path.replace(/^\//, ""),
            },
            properties,
          } as CreatePageParameters)
          .then((page) => ({ notebookPageId: page.id, preExisting: false }));
      } else if (/[a-f0-9]{32}$/.test(path)) {
        const page_id = /[a-f0-9]{32}$/.exec(path)?.[0];
        if (page_id) {
          return notionClient.pages
            .create({
              parent: { page_id },
              properties,
            })
            .then((page) => ({ notebookPageId: page.id, preExisting: false }));
        } else {
          throw new Error(`Invalid path: ${path}`);
        }
      } else {
        const { results } = await notionClient.search({});
        const parent = results.find(
          (result): result is PageObjectResponse | DatabaseObjectResponse =>
            "parent" in result &&
            result.parent.type === "workspace" &&
            result.parent.workspace
        );
        if (!parent) {
          throw new Error(`No root level page or database found`);
        }
        if (parent.object === "database") {
          const { id } = await notionClient.pages.create({
            parent: { database_id: parent.id },
            properties,
          } as CreatePageParameters);
          return { notebookPageId: id, preExisting: false };
        }
        const { id } = await notionClient.pages.create({
          parent: { page_id: parent.id },
          properties,
        } as CreatePageParameters);
        return { notebookPageId: id, preExisting: false };
      }
    },
  getDeletePage:
    ({ accessToken }) =>
    async (notebookPageId) => {
      const notionClient = new NotionClient({
        auth: accessToken,
      });
      await notionClient.pages.update({
        page_id: notebookPageId,
        archived: true,
      });
      return { success: true };
    },
  getOpenPage:
    ({ accessToken }) =>
    async (notebookPageId) => {
      const notionClient = new NotionClient({
        auth: accessToken,
      });
      const page = await notionClient.pages.retrieve({
        page_id: notebookPageId,
      });
      return "url" in page
        ? {
            notebookPageId,
            url: page.url,
          }
        : {
            notebookPageId,
            url: "",
          };
    },
});

export default backend;
