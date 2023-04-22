import { Annotation, InitialSchema } from "samepage/internal/types";
import defaultNotionClient from "./notionClient";
import toUuid from "./toUuid";
import type {
  BlockObjectResponse,
  BlockObjectRequest,
  RichTextItemRequest,
} from "@notionhq/client/build/src/api-endpoints";

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
type NotionNode = {
  id: string;
  children: NotionNode[];
  data: BlockObjectRequest;
  level: number;
};

export const getRichTextItemsRequest = ({
  annotation,
  text,
}: Pick<SamepageNode, "text" | "annotation">): RichTextItemRequest[] => {
  const preRichTextItems: {
    start: number;
    end: number;
    annotations: Annotation[];
  }[] = [];
  annotation.annotations.forEach((anno) => {
    const { start: _start, end: _end } = anno;
    const start = _start - annotation.start;
    const end = _end - annotation.start;
    const annotations: Annotation[] = [];
    const lastItem = preRichTextItems[preRichTextItems.length - 1];
    const lastItemIndex = !lastItem ? 0 : lastItem.end;
    if (start > lastItemIndex) {
      preRichTextItems.push({
        start: lastItemIndex,
        end: start,
        annotations: [],
      });
    } else if (start < lastItemIndex) {
      if (start === lastItem.start) {
        preRichTextItems.pop();
      } else {
        lastItem.end = start;
      }
      annotations.push(...(lastItem.annotations || []));
    }
    preRichTextItems.push({
      start,
      end,
      annotations: annotations.concat(anno),
    });
  });
  const lastItem = preRichTextItems[preRichTextItems.length - 1];
  const lastItemIndex = !lastItem ? 0 : lastItem.end;
  if (text.length > lastItemIndex) {
    preRichTextItems.push({
      start: lastItemIndex,
      end: text.length,
      annotations: [],
    });
  }
  return preRichTextItems.map((item) => ({
    type: "text",
    text: {
      content: text.slice(item.start, item.end),
    },
    annotations: item.annotations.reduce((acc, anno) => {
      if (anno.type === "bold") {
        return { ...acc, bold: true };
      } else if (anno.type === "italics") {
        return { ...acc, italic: true };
      } else if (anno.type === "strikethrough") {
        return { ...acc, strikethrough: true };
      } else if (anno.type === "inline") {
        return { ...acc, code: true };
        // } else if (anno.type === "underline") {
        // } else if (anno.type === "color") {
      } else {
        return acc;
      }
    }, {}),
  }));
};

const getExpectedBlockData = (node: SamepageNode): BlockObjectRequest => {
  const { viewType } = node;
  switch (viewType) {
    case "document": {
      return {
        type: "paragraph",
        paragraph: {
          rich_text: getRichTextItemsRequest(node),
        },
      };
    }
    case "bullet": {
      return {
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: getRichTextItemsRequest(node),
        },
      };
    }
    case "numbered": {
      return {
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: getRichTextItemsRequest(node),
        },
      };
    }
  }
};

const applyState = async (
  notebookPageId: string,
  state: InitialSchema,
  notionClient = defaultNotionClient
) => {
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
  const getTree = async (block_id: string, level = 1): Promise<NotionNode[]> =>
    notionClient.blocks.children
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
  const tree = await getTree(rootUuid);
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
                .find(({ level }) => level < expectedNode.level)?.originalIndex;
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
      const expectedBlockData = getExpectedBlockData(expectedNode);
      if (actualTree.length > index) {
        const actualNode = actualTree[index];
        const block_id = actualNode.id;
        return notionClient.blocks
          .update({
            block_id,
            ...expectedBlockData,
          })
          .catch((e) => {
            console.error(e, expectedBlockData);
            return Promise.reject(
              new Error(`Failed to update block: ${e.message}`)
            );
          })
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
        return notionClient.blocks.children
          .append({
            block_id: parentId,
            children: [expectedBlockData],
          })
          .then((response) => {
            const newActualNode = response.results[0] as BlockObjectResponse;
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
          notionClient.blocks
            .delete({ block_id: a.id })
            .then(() => Promise.resolve())
            .catch((e) =>
              Promise.reject(new Error(`Failed to remove block: ${e.message}`))
            )
      )
    );

  return promises.reduce((p, c) => p.then(c), Promise.resolve<unknown>(""));
};

export default applyState;
