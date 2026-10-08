import { handle, json } from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/request";
import type { RegisterDocumentResponse } from "@/lib/api/types";
import {
  parseDocumentRequest,
  registerDocument,
  removeKitchenPhoto,
  requireChef,
  toApplication,
} from "@/lib/server/chef-application";

// POST /api/chef/application/documents: register a file the browser already uploaded to Storage
// (ID document, food-handler certificate or kitchen photo). The object must exist; a changed
// document or kitchen resets the matching MOCK check (N1).
export function POST(request: Request) {
  return handle(async () => {
    const chef = await requireChef();
    const body = await readJsonObject(request);
    const req = parseDocumentRequest(chef, body, "register");
    const out: RegisterDocumentResponse = {
      application: toApplication(await registerDocument(chef, req)),
    };
    return json(out);
  });
}

// DELETE /api/chef/application/documents: remove a registered kitchen photo and delete its
// object. Same kitchen reset as above.
export function DELETE(request: Request) {
  return handle(async () => {
    const chef = await requireChef();
    const body = await readJsonObject(request);
    const req = parseDocumentRequest(chef, body, "remove");
    const out: RegisterDocumentResponse = {
      application: toApplication(await removeKitchenPhoto(chef, req)),
    };
    return json(out);
  });
}
