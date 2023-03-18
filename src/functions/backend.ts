import createAPIGatewayProxyHandler from "samepage/backend/createAPIGatewayProxyHandler";
import { Client as NotionClient } from "@notionhq/client";
import type {
  BlockObjectResponse,
  BlockObjectRequest,
} from "@notionhq/client/build/src/api-endpoints";
import { InitialSchema, zInitialSchema } from "samepage/internal/types";
import { z } from "zod";

const toUuid = (notebookPageId: string) =>
  notebookPageId.replace(/^(?:.*?)([a-f0-9]{32})$/, "$1");

const notion = new NotionClient({
  auth: process.env.NOTION_INTEGRATION_TOKEN,
});

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
    data: z.object({ notebookPageId: z.string() }),
  }),
  z.object({
    type: z.literal("APPLY_STATE"),
    data: z.object({ notebookPageId: z.string(), state: zInitialSchema }),
  }),
]);

const logic = async (args: { type: string; data: unknown }) => {
  const { type, data } = zMessage.parse(args);
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
      const toAtJson = ({
        block_id,
        startIndex = 0,
        level = 0,
      }: {
        block_id: string;
        startIndex?: number;
        level?: number;
      }): Promise<InitialSchema> =>
        notion.blocks.children.list({ block_id }).then((r) =>
          r.results
            .map((n) => async (index: number) => {
              if (!("type" in n)) return { content: "", annotations: [] };
              const parseBlock = (): InitialSchema => {
                if (n.type === "paragraph") {
                  const content = `${n.paragraph.rich_text.map(
                    (t) => t.plain_text
                  )}\n`;
                  const end = content.length + index;
                  return {
                    content,
                    annotations: [
                      {
                        start: index,
                        end,
                        attributes: {
                          level: level,
                          viewType: "document",
                        },
                        type: "block",
                      },
                    ],
                  };
                } else {
                  return { content: "", annotations: [] };
                }
              };
              const { content, annotations } = parseBlock();
              const {
                content: childrenContent,
                annotations: childrenAnnotations,
              } = n.has_children
                ? await toAtJson({
                    block_id: n.id,
                    level: level + 1,
                    startIndex: content.length,
                  })
                : { content: "", annotations: [] };
              return {
                content: `${content}${childrenContent}`,
                annotations: annotations.concat(childrenAnnotations),
              };
            })
            .reduce(
              (p, c) =>
                p.then(({ content: pc, annotations: pa }) =>
                  c(startIndex + pc.length).then(
                    ({ content: cc, annotations: ca }) => ({
                      content: `${pc}${cc}`,
                      annotations: pa.concat(ca),
                    })
                  )
                ),
              Promise.resolve<InitialSchema>({
                content: "",
                annotations: [],
              })
            )
        );
      const { notebookPageId } = data as { notebookPageId: string };
      return toAtJson({
        block_id: toUuid(notebookPageId),
      })
        .then((data) => ({ success: true, data }))
        .catch((error) => ({ success: false, data: error }));
    }
    case "APPLY_STATE": {
      type SamepageNode = {
        text: string;
        level: number;
        viewType: "bullet" | "numbered" | "document";
        annotation: {
          start: number;
          end: number;
          annotations: InitialSchema["annotations"];
        };
      };
      const { notebookPageId, state } = data as {
        notebookPageId: string;
        state: InitialSchema;
      };
      const rootUuid = toUuid(notebookPageId);
      const expectedTree: SamepageNode[] = [];
      state.annotations.forEach((anno) => {
        if (anno.type === "block") {
          const currentBlock: SamepageNode = {
            text: state.content.slice(anno.start, anno.end).replace(/\n$/, ""),
            level: anno.attributes.level,
            viewType: anno.attributes.viewType,
            annotation: {
              start: anno.start,
              end: anno.end,
              annotations: [],
            },
          };
          expectedTree.push(currentBlock);
        } else {
          const block = expectedTree.find(
            (ca) =>
              ca.annotation.start <= anno.start && anno.end <= ca.annotation.end
          );
          if (block) {
            block.annotation.annotations.push(anno);
          }
        }
      });
      type NotionNode = {
        id: string;
        children: NotionNode[];
        data: BlockObjectRequest;
        level: number;
      };
      const getTree = async (
        block_id: string,
        level = 1
      ): Promise<NotionNode[]> =>
        notion.blocks.children
          .list({ block_id })
          .then((c) =>
            Promise.all(
              c.results.map(async (r) =>
                "type" in r
                  ? ({
                      id: r.id,
                      children: r.has_children
                        ? await getTree(r.id, level + 1)
                        : [],
                      data: r,
                      level,
                    } as NotionNode)
                  : undefined
              )
            )
          )
          .then((r) => r.filter((n): n is NotionNode => !!n));
      const flattenTree = (tree: NotionNode[]): NotionNode[] => {
        return tree.flatMap((t) => {
          const children = flattenTree(t.children);
          return [{ ...t, children }, ...children];
        });
      };
      return getTree(rootUuid)
        .then((tree) => {
          const actualTree = flattenTree(tree);
          const promises = expectedTree
            .map((expectedNode, index) => () => {
              const getLocation = () => {
                const _parentIndex =
                  expectedNode.level === 1
                    ? -1
                    : actualTree
                        .slice(0, index)
                        .map((node, originalIndex) => ({
                          level: node.level,
                          originalIndex,
                        }))
                        .reverse()
                        .concat([{ level: 0, originalIndex: -1 }])
                        .find(({ level }) => level < expectedNode.level)
                        ?.originalIndex;
                const parentIndex =
                  typeof _parentIndex === "undefined" ? -1 : _parentIndex;
                const order = expectedTree
                  .slice(Math.max(0, parentIndex), index)
                  .filter((e) => e.level === expectedNode.level).length;
                return {
                  order,
                  parentId:
                    parentIndex < 0
                      ? rootUuid
                      : actualTree[parentIndex]?.id || rootUuid,
                };
              };
              const expectedBlockData: BlockObjectRequest = {
                type: "paragraph" as const,
                paragraph: {
                  rich_text: [{ text: { content: expectedNode.text } }],
                },
              };
              if (actualTree.length > index) {
                const actualNode = actualTree[index];
                const block_id = actualNode.id;
                return notion.blocks
                  .update({
                    block_id,
                    ...expectedBlockData,
                  })
                  .catch((e) =>
                    Promise.reject(
                      new Error(`Failed to update block: ${e.message}`)
                    )
                  )
                  .then(async () => {
                    if ((actualNode.level || 0) !== expectedNode.level) {
                      const {
                        parentId,
                        //  order
                      } = getLocation();
                      if (parentId) {
                        // TODO MOVING
                        //
                        // await window.roamAlphaAPI
                        //   .moveBlock({
                        //     location: { "parent-uid": parentId, order },
                        //     block: { uid: actualNode.uid },
                        //   })
                        //   .then(() => {
                        //     updateLevel(actualNode, expectedNode.level);
                        //     actualNode.order = order;
                        //   })
                        //   .catch((e) =>
                        //     Promise.reject(
                        //       new Error(`Failed to move block: ${e.message}`)
                        //     )
                        //   );
                      }
                    }
                    actualNode.data = {
                      ...actualNode.data,
                      ...expectedBlockData,
                    } as BlockObjectRequest;
                    return Promise.resolve();
                  });
              } else {
                const { parentId, order } = getLocation();
                // TODO - could condense to single API call.
                return notion.blocks.children
                  .append({
                    block_id: parentId,
                    children: [expectedBlockData],
                  })
                  .then((response) => {
                    const newActualNode = response
                      .results[0] as BlockObjectResponse;
                    actualTree.push({
                      data: newActualNode as BlockObjectRequest,
                      level: 1,
                      children: [],
                      id: newActualNode.id,
                    });
                  })
                  .catch((e) =>
                    Promise.reject(
                      new Error(
                        `Failed to append block: ${e.message}\nParentUid: ${parentId}\nNotebookPageId:${rootUuid}`
                      )
                    )
                  );
              }
            })
            .concat(
              actualTree.slice(expectedTree.length).map(
                (a) => () =>
                  notion.blocks
                    .delete({ block_id: a.id })
                    .then(() => Promise.resolve())
                    .catch((e) =>
                      Promise.reject(
                        new Error(`Failed to remove block: ${e.message}`)
                      )
                    )
              )
            );

          return promises.reduce(
            (p, c) => p.then(c),
            Promise.resolve<unknown>("")
          );
        })
        .then(() => ({ data: "", success: true }))
        .catch((e) => ({ data: e, success: false }));
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
