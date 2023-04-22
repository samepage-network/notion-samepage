const toUuid = (notebookPageId: string) =>
  notebookPageId.replace(/-/g, "").replace(/^(?:.*?)([a-f0-9]{32})$/, "$1");

export default toUuid;
