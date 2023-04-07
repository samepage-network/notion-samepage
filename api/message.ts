import apiClient, { apiPost } from "samepage/internal/apiClient";
import {
  JSONData,
  Schema,
  zInitialSchema,
} from "samepage/internal/types";
import { z } from "zod";
import base64ToBinary from "samepage/internal/base64ToBinary";
import Automerge from "automerge";
import { HandlerError } from "samepage/internal/setupMessageHandlers";
import binaryToBase64 from "samepage/internal/binaryToBase64";
import parseActorId from "samepage/internal/parseActorId";
import unwrapSchema from "samepage/utils/unwrapSchema";
import applyState from "src/utils/applyState";
import parseZodError from "samepage/utils/parseZodError";
import sendExtensionError from "samepage/internal/sendExtensionError";
import sendToNotebook from "samepage/internal/sendToNotebook";

const zMessageBody = z
  .object({
    credentials: z.object({
      notebookUuid: z.string(),
      token: z.string(),
      accessToken: z.string(),
    }),
    source: z.object({
      uuid: z.string(),
      app: z.number(),
      workspace: z.string(),
      appName: z.string(),
    }),
  })
  .and(
    z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("ERROR"), message: z.string() }),
      z.object({
        operation: z.literal("AUTHENTICATION"),
        reason: z.string().optional(),
        success: z.boolean(),
      }),
      z.object({ operation: z.literal("PING") }),

      z.object({ operation: z.literal("SHARE_PAGE"), title: z.string() }),
      z.object({
        operation: z.literal("SHARE_PAGE_RESPONSE"),
        success: z.boolean(),
        title: z.string(),
        rejected: z.boolean(),
      }),
      z.object({
        operation: z.literal("SHARE_PAGE_UPDATE"),
        changes: z.string().array(),
        notebookPageId: z.string(),
        dependencies: z.record(z.object({ seq: z.number(), hash: z.string() })),
      }),
      z.object({
        operation: z.literal("SHARE_PAGE_FORCE"),
        state: z.string(),
        notebookPageId: z.string(),
      }),
      z.object({
        operation: z.literal("REQUEST_PAGE_UPDATE"),
        notebookPageId: z.string(),
        seq: z.number(),
      }),

      z.object({
        operation: z.literal("REQUEST_DATA"),
        request: z.record(z.any()),
        uuid: z.string(),
        source: z.string(),
      }),
      z.object({ operation: z.literal("REQUEST"), request: z.record(z.any()) }),
      z.object({
        operation: z.literal("RESPONSE"),
        request: z.record(z.any()),
        response: z.record(z.any()),
      }),
    ])
  );

// TODO: What does dispatchAppEvent look like?
// TODO: These are stubs
const has = (_: string) => true;
const load = (_: string) =>
  Promise.resolve<Automerge.FreezeObject<Schema>>(Automerge.init());
const set = (_: string, __: Automerge.FreezeObject<Schema>) => {};
const pendingUpdates: Record<string, (() => Promise<unknown>)[]> = {};

const notebookRequestHandlers: ((
  request: JSONData
) => Promise<JSONData | undefined>)[] = [];
const handleRequest = async ({
  request,
  target,
}: {
  request: JSONData;
  target: string;
}) => {
  const response = await notebookRequestHandlers.reduce(
    (p, c) => p.then((prev) => prev || c(request)),
    Promise.resolve() as Promise<JSONData | undefined>
  );
  if (response) {
    apiClient({
      method: "notebook-response",
      request,
      response,
      target,
    });
  }
};

const message = async (_args: unknown) => {
  try {
    const args = zMessageBody.parse(_args);
    const saveAndApply = (
      notebookPageId: string,
      doc: Automerge.FreezeObject<Schema>
    ) => {
      const docToApply = unwrapSchema(doc);
      return zInitialSchema
        .safeParseAsync(docToApply)
        .then((parseResult) => {
          if (parseResult.success) {
            return applyState(notebookPageId, parseResult.data);
          } else {
            // let's not throw yet - let's see how many emails this generates first - can revisit this in a few months
            // This is the previous behavior
            sendExtensionError({
              type: `State received from other notebook was corrupted`,
              data: {
                error: parseResult.error,
                message: parseZodError(parseResult.error),
                input: docToApply,
              },
            });
            return applyState(notebookPageId, docToApply);
          }
        })
        .then(async () => {
          if (!Automerge.isFrozen(doc)) {
            // I think it's safe to say that if another change comes in, freezing this doc, it's outdated and not worth saving?
            // this could have bad implications on history though - TODO
            // - not that bad, because currently our document stores full history.
            await apiClient({
              method: "save-page-version",
              notebookPageId,
              state: binaryToBase64(Automerge.save(doc)),
            }).catch((e) => {
              console.warn(`Failed to broadcast new version: ${e.message}`);
            });
          }
          console.log(`Applied update`);
        })
        .catch((e) => {
          apiPost({
            path: "errors",
            data: {
              method: "extension-error",
              type: "Failed to Apply Change",
              notebookUuid: args.credentials.notebookUuid,
              data:
                e instanceof HandlerError
                  ? e.data
                  : e instanceof Error
                  ? { message: e.message }
                  : typeof e !== "object"
                  ? { message: e }
                  : e === null
                  ? {}
                  : e,
              message: e instanceof Error ? e.message : "Unknown data thrown",
              stack: e instanceof Error ? e.stack : "Unknown stacktrace",
              version: process.env.VERSION,
            },
          });
          console.warn(
            `Failed to apply new change: ${e.message.slice(0, 50)}${
              e.message.length > 50 ? "..." : ""
            }`
          );
        });
    };
    if (args.operation === "ERROR") {
      console.error(args.message);
      // TODO - should I email?
    } else if (args.operation === "AUTHENTICATION") {
      // TODO - Unsupported right?
    } else if (args.operation === "PING") {
      // TODO - Unsupported right?
    } else if (args.operation === "SHARE_PAGE") {
      // TODO: How do we dispatch a notification and
      // allow a choice between "Accept" and "Reject"?
      // EMAIL! EMAIL IS THE ANSWER!!!
      // - Both buttons are in the email and take you to a public SamePage route. 
      // - That route then performs the accept or reject, redirecting you to the notebook. BOOM!
    } else if (args.operation === "SHARE_PAGE_RESPONSE") {
      // Usueally just an in-app popup saying "Accepted" or "Rejected"
    } else if (args.operation === "SHARE_PAGE_UPDATE") {
      const { changes, notebookPageId, dependencies = {} } = args;
      if (!has(notebookPageId))
        throw new Error(`No such page: ${notebookPageId}`);
      const executeUpdate = () =>
        load(notebookPageId)
          .then((oldDoc) => {
            const binaryChanges = changes.map(
              (c) => base64ToBinary(c) as Automerge.BinaryChange
            );
            const [newDoc, patch] = Automerge.applyChanges(
              oldDoc,
              binaryChanges
            );
            set(notebookPageId, newDoc);
            if (patch.pendingChanges) {
              const storedChanges = Automerge.getAllChanges(newDoc).map((c) =>
                Automerge.decodeChange(c)
              );
              const existingDependencies = Object.fromEntries(
                storedChanges.map((c) => [`${c.actor}~${c.seq}`, c.hash])
              );
              const me = Automerge.getActorId(newDoc);
              if (
                Object.entries(dependencies).some(
                  ([actor, { seq, hash }]) =>
                    actor !== me &&
                    existingDependencies[`${actor}~${seq}`] &&
                    existingDependencies[`${actor}~${seq}`] !== hash
                )
              ) {
                throw new Error(
                  `It looks like your version of the shared page ${notebookPageId} is corrupted and will cease to apply updates from other notebooks in the future. To resolve this issue, ask one of the other connected notebooks to manually sync the page.`
                );
              } else {
                const storedHashes = new Set(
                  storedChanges.map((c) => c.hash || "")
                );
                const actorsToRequest = Object.entries(patch.clock).filter(
                  ([actor, seq]) => {
                    if (me === actor) {
                      return false;
                    }
                    const dependentHashFromActor =
                      existingDependencies[`${actor}~${seq}`];
                    return !(
                      dependentHashFromActor &&
                      storedHashes.has(dependentHashFromActor)
                    );
                  }
                );
                if (!actorsToRequest.length && !Automerge.isFrozen(newDoc)) {
                  const missingDependencies = binaryChanges
                    .map((c) => Automerge.decodeChange(c))
                    .flatMap((c) => c.deps)
                    .filter((c) => !storedHashes.has(c));
                  throw new HandlerError(
                    "No actors to request and still waiting for changes",
                    {
                      missingDependencies,
                      binaryDocument: binaryToBase64(Automerge.save(newDoc)),
                      notebookPageId,
                    }
                  );
                } else {
                  actorsToRequest.forEach(([actor]) => {
                    sendToNotebook({
                      target: parseActorId(actor),
                      operation: "REQUEST_PAGE_UPDATE",
                      data: {
                        notebookPageId,
                        seq: patch.clock[actor],
                      },
                    });
                  });
                }
              }
            }
            if (Object.keys(patch.diffs.props).length) {
              saveAndApply(notebookPageId, newDoc);
            }
          })
          .finally(() => {
            if (pendingUpdates[notebookPageId].length === 0) {
              delete pendingUpdates[notebookPageId];
              return Promise.resolve();
            } else {
              return pendingUpdates[notebookPageId].shift()?.();
            }
          });
    } else if (args.operation === "SHARE_PAGE_FORCE") {
    } else if (args.operation === "REQUEST_PAGE_UPDATE") {
    } else if (args.operation === "REQUEST_DATA") {
    } else if (args.operation === "REQUEST") {
      await handleRequest({ request: args.request, target: args.source.uuid });
    } else if (args.operation === "RESPONSE") {
    }
    return { success: true };
  } catch (e) {
    return { success: false };
  }
};

export default message;
