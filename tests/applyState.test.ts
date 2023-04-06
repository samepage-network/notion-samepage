import { test, expect } from "@playwright/test";
import applyState from "../src/utils/applyState";
import { v4 } from "uuid";
import { InitialSchema } from "samepage/internal/types";
import notionClient from "../src/utils/notionClient";
import type {
  BlockObjectResponse,
  BlockObjectRequest,
  UpdateBlockParameters,
  PageObjectResponse,
  CreatePageParameters,
  ParagraphBlockObjectResponse,
  AppendBlockChildrenParameters,
} from "@notionhq/client/build/src/api-endpoints";

const mockNotionDatabase: {
  pages: Record<string, PageObjectResponse>;
  blocks: Record<string, BlockObjectResponse>;
  children: Record<string, string[]>;
} = {
  pages: {},
  blocks: {},
  children: {},
};
const by = { id: v4(), object: "user" as const };

const blockObjectReqToRes = (
  c: BlockObjectRequest,
  pageId: String
): BlockObjectResponse =>
  ({
    ...c,
    type: c.type,
    id: v4(),
    parent: {
      type: "page_id" as const,
      page_id: pageId,
    },
    object: "block",
    created_time: new Date().toJSON(),
    last_edited_time: new Date().toJSON(),
    has_children: false,
    created_by: by,
    last_edited_by: by,
    archived: false,
  } as BlockObjectResponse);

test.beforeAll(() => {
  // @ts-ignore
  notionClient.request = async (args: {
    path: string;
    method: "get" | "patch" | "post" | "put" | "delete";
    query: Record<string, string>;
    body: Record<string, unknown>;
    auth: string;
  }) => {
    const { path, method, body } = args;
    const paths = path.split("/");
    if (method === "get" && paths[0] === "blocks" && paths[2] === "children") {
      const results = mockNotionDatabase.children[paths[1]].map(
        (id) => mockNotionDatabase.blocks[id]
      );
      if (!results)
        return Promise.reject(new Error(`Block Id ${paths[1]} not found`));
      return Promise.resolve({ results });
    } else if (
      method === "patch" &&
      paths[0] === "blocks" &&
      paths[2] === "children"
    ) {
      const id = paths[1];
      if (!mockNotionDatabase.pages[id] && !mockNotionDatabase.blocks[id])
        return Promise.reject(new Error(`Block Id ${id} not found`));
      const appendBody = body as AppendBlockChildrenParameters;
      const blocks = mockNotionDatabase.children[id];
      const results = appendBody.children.map((c) => {
        const blockId = v4();
        const block = blockObjectReqToRes(c, id);
        mockNotionDatabase.blocks[blockId] = block;
        blocks.push(blockId);
        return block;
      });
      return { results };
    } else if (method === "post" && paths[0] === "pages") {
      const time = new Date().toJSON();
      const pageId = v4();
      const { children, properties, parent } = body as CreatePageParameters;
      mockNotionDatabase.pages[pageId] = {
        id: pageId,
        properties: properties as PageObjectResponse["properties"],
        parent: parent as PageObjectResponse["parent"],
        icon: { type: "emoji" as const, emoji: "📝" },
        object: "page",
        created_time: time,
        last_edited_time: time,
        archived: false,
        cover: null,
        url: `https://www.notion.so/${pageId}`,
        created_by: by,
        last_edited_by: by,
      };
      const blockChildren = (children || [])
        .map((c) =>
          !c.type
            ? undefined
            : ({
                ...c,
                type: c.type,
                id: v4(),
                parent: {
                  type: "page_id" as const,
                  page_id: pageId,
                },
                object: "block",
                created_time: new Date().toJSON(),
                last_edited_time: new Date().toJSON(),
                has_children: false,
                created_by: by,
                last_edited_by: by,
                archived: false,
              } as BlockObjectResponse)
        )
        .filter((c): c is BlockObjectResponse => !!c);
      mockNotionDatabase.children[pageId] = blockChildren.map((c) => c.id);
      blockChildren.forEach((c) => {
        mockNotionDatabase.blocks[c.id] = c;
        mockNotionDatabase.children[c.id] = [];
      });
      return Promise.resolve(mockNotionDatabase.pages[pageId]);
    } else if (method === "patch" && paths[0] === "blocks") {
      const id = paths[1];
      if (!mockNotionDatabase.blocks[id])
        return Promise.reject(new Error(`Block Id ${id} not found`));
      const block = mockNotionDatabase.blocks[id];
      const updateBody = body as UpdateBlockParameters;
      if (!("type" in updateBody))
        return Promise.reject(new Error(`Block update for ${id} missing type`));

      if (block.type !== updateBody.type)
        return Promise.reject(
          new Error(
            `Block update for ${id} failed: Notion doesn't support different types`
          )
        );

      const newBlock = {
        ...block,
        ...updateBody,
      };
      // @ts-ignore
      mockNotionDatabase.blocks[id] = newBlock;
      return Promise.resolve(newBlock);
    } else {
      return Promise.reject(new Error(`Unknown request: ${method} ${path}`));
    }
  };
});

test("second block annotations", async () => {
  const state: InitialSchema = {
    content: "First\nSecond block\n",
    annotations: [
      {
        type: "block",
        start: 0,
        end: 6,
        attributes: { level: 0, viewType: "document" },
      },
      {
        type: "block",
        start: 6,
        end: 19,
        attributes: { level: 0, viewType: "document" },
      },
      {
        type: "bold",
        start: 6,
        end: 12,
      },
    ],
  };
  const page = await notionClient.pages.create({
    parent: { database_id: "123" },
    properties: { title: { title: [{ text: { content: v4() } }] } },
    children: [
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              text: {
                content: "",
              },
            },
          ],
        },
      },
    ],
  });

  await applyState(page.id, state);

  const {
    results: [first, second],
  } = await notionClient.blocks.children.list({
    block_id: page.id,
  });
  expect((first as ParagraphBlockObjectResponse).paragraph.rich_text).toEqual([
    { text: { content: "First" }, type: "text", annotations: {} },
  ]);
  expect((second as ParagraphBlockObjectResponse).paragraph.rich_text).toEqual([
    { text: { content: "Second" }, type: "text", annotations: { bold: true } },
    { text: { content: " block" }, type: "text", annotations: {} },
  ]);
});
