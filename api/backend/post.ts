import createAPIGatewayProxyHandler from "samepage/backend/createAPIGatewayProxyHandler";
import getAccessToken from "samepage/backend/getAccessToken";
import { Client as NotionClient } from "@notionhq/client";
import {
  BackendRequest,
  zSamePageSchema,
  zSamePageState,
} from "samepage/internal/types";
import { z } from "zod";
import toAtJson from "../../src/utils/toAtJson";
import toUuid from "../../src/utils/toUuid";
import applyState, { getRichTextItemsRequest } from "src/utils/applyState";
import {
  CreatePageParameters,
  DatabaseObjectResponse,
  PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import debug from "samepage/utils/debugger";
const log = debug("api:backend");

const zMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SETUP") }),
  z.object({
    type: z.literal("OPEN_PAGE"),
    notebookPageId: z.string(),
  }),
  z.object({
    type: z.literal("ENSURE_PAGE_BY_TITLE"),
    title: zSamePageSchema,
    path: z.string().optional(),
  }),
  z.object({
    type: z.literal("DELETE_PAGE"),
    notebookPageId: z.string(),
  }),
  z.object({
    type: z.literal("ENCODE_STATE"),
    notebookPageId: z.string(),
    notebookUuid: z.string(),
  }),
  z.object({
    type: z.literal("DECODE_STATE"),
    notebookPageId: z.string(),
    state: zSamePageState,
  }),
]);

const logic = async (args: BackendRequest<typeof zMessage>) => {
  const { authorization, ...data } = args;
  if (!authorization) {
    throw new Error("Unauthorized");
  }
  log("backend post", data.type);

  const accessToken = authorization.startsWith("Basic")
    ? await getAccessToken({
        authorization,
      }).then(({ accessToken }) => accessToken)
    : authorization.replace(/^Bearer /, "");
  const notionClient = new NotionClient({
    auth: accessToken,
  });
  try {
    switch (data.type) {
      case "SETUP": {
        const response = await notionClient.users
          .me({})
          .catch(() => false as const);
        return response &&
          response.type === "bot" &&
          !!response.bot.workspace_name
          ? {
              data: {
                app: "Notion",
                workspace: response.bot.workspace_name,
              },
            }
          : {
              data: false,
            };
      }
      case "ENSURE_PAGE_BY_TITLE": {
        const { path = "", title } = data;
        const pages = await notionClient.search({
          query: title.content,
          filter: {
            property: "object",
            value: "page",
          },
        });
        const existingPage = pages.results.find(
          (p) =>
            "properties" in p &&
            p.properties.title.type === "title" &&
            Array.isArray(p.properties.title.title) &&
            p.properties.title.title[0].plain_text === title.content
        );
        if (existingPage) {
          return { notebookPageId: existingPage.id, preExisting: true };
        }
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
            .then((page) => ({ notebookPageId: page.id }));
        } else if (/[a-f0-9]{32}$/.test(path)) {
          const page_id = /[a-f0-9]{32}$/.exec(path)?.[0];
          if (page_id) {
            return notionClient.pages
              .create({
                parent: { page_id },
                properties,
              })
              .then((page) => ({ notebookPageId: page.id }));
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
            return { notebookPageId: id };
          }
          const { id } = await notionClient.pages.create({
            parent: { page_id: parent.id },
            properties,
          } as CreatePageParameters);
          return { notebookPageId: id };
        }
      }
      case "DELETE_PAGE": {
        const { notebookPageId } = data;
        return notionClient.pages
          .update({
            page_id: notebookPageId,
            archived: true,
          })
          .then(() => ({ data: notebookPageId }));
      }
      case "OPEN_PAGE": {
        const { notebookPageId } = data;
        const page = await notionClient.pages.retrieve({
          page_id: notebookPageId,
        });
        return "url" in page
          ? {
              url: page.url,
            }
          : {
              url: "",
            };
      }
      case "ENCODE_STATE": {
        const { notebookPageId, notebookUuid } = data;
        return toAtJson({
          block_id: toUuid(notebookPageId),
          notebookUuid,
          notionClient,
        }).then((data) => ({ $body: data }));
      }
      case "DECODE_STATE": {
        await applyState(data.notebookPageId, data.state.$body, notionClient);
        return { success: true };
      }
      default:
        throw new Error(`Unknown type ${data["type"]}`);
    }
  } catch (e) {
    log("error", e);
    throw new Error(`Backend request ${data.type} failed`, { cause: e });
  }
};

const backend = createAPIGatewayProxyHandler({
  logic,
  // @ts-ignore
  bodySchema: zMessage,
  allowedOrigins: [/^https:\/\/([\w]+\.)?notion\.so/],
});

export default backend;
