import createAPIGatewayProxyHandler from "samepage/backend/createAPIGatewayProxyHandler";
import { Client as NotionClient } from "@notionhq/client";
import { zInitialSchema } from "samepage/internal/types";
import { z } from "zod";
import toAtJson from "../utils/toAtJson";
import toUuid from "../utils/toUuid";
import applyState from "src/utils/applyState";

const zMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SETUP"), data: z.object({}).optional() }),
  z.object({
    type: z.literal("CREATE_PAGE"),
    data: z.object({ notebookPageId: z.string(), path: z.string() }),
  }),
  z.object({
    type: z.literal("DELETE_PAGE"),
    data: z.object({ notebookPageId: z.string() }),
  }),
  z.object({
    type: z.literal("CALCULATE_STATE"),
    data: z.object({ notebookPageId: z.string(), notebookUuid: z.string() }),
  }),
  z.object({
    type: z.literal("APPLY_STATE"),
    data: z.object({ notebookPageId: z.string(), state: zInitialSchema }),
  }),
]);

const logic = async (args: { type: string; data: unknown }) => {
  const { type, data } = zMessage.parse(args);
  const notion = new NotionClient({
    auth: process.env.NOTION_INTEGRATION_TOKEN,
  });
  switch (type) {
    case "SETUP": {
      const response = await notion.users.me({}).catch(() => false as const);
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
    case "CREATE_PAGE": {
      const { path, notebookPageId } = data as {
        path: string;
        notebookPageId: string;
      };
      if (/^\/?[a-f0-9]{32}$/.test(path)) {
        return notion.pages
          .create({
            parent: { database_id: path.replace(/^\//, "") },
            properties: {
              title: { title: [{ text: { content: notebookPageId } }] },
            },
          })
          .then((page) => ({ data: page.id }));
      } else if (/[a-f0-9]{32}$/.test(path)) {
        const page_id = /[a-f0-9]{32}$/.exec(path)?.[0];
        if (page_id) {
          return notion.pages
            .create({
              parent: { page_id },
              properties: {
                title: { title: [{ text: { content: notebookPageId } }] },
              },
            })
            .then((page) => ({ data: page.id }));
        } else {
          throw new Error(`Invalid path: ${path}`);
        }
      } else {
        return { data: "" };
      }
    }
    case "DELETE_PAGE": {
      const { notebookPageId } = data as { notebookPageId: string };
      const page_id = /[a-f0-9]{32}$/.exec(notebookPageId)?.[0];
      if (page_id)
        return notion.pages
          .update({
            page_id,
            archived: true,
          })
          .then(() => ({ data: page_id }));
      else {
        throw new Error(`Invalid notebook page id: ${notebookPageId}`);
      }
    }
    case "CALCULATE_STATE": {
      const { notebookPageId, notebookUuid } = data;
      return toAtJson({
        block_id: toUuid(notebookPageId),
        notebookUuid,
      })
        .then((data) => ({ success: true, data }))
        .catch((error) => {
          console.error(error);
          return { success: false, data: error.message };
        });
    }
    case "APPLY_STATE": {
      return applyState(data)
        .then(() => ({ data: "", success: true }))
        .catch((e) => ({ data: e.message, success: false }));
    }
    default:
      throw new Error(`Unknown type ${type}`);
  }
};

const backend = createAPIGatewayProxyHandler({
  logic,
  allowedOrigins: [/^https:\/\/([\w]+\.)?notion\.so/],
});

export default backend;
