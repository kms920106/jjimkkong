import { getMember } from "@/lib/auth";
import { listsForMember } from "@/lib/place-list";
import ListsClient from "@/components/list/ListsClient";

// Reads the session cookie, so this page is always rendered per request.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "저장 · 찜꽁",
};

export default async function ListsPage() {
  // Public like every other page: signed out this is an empty list offering a
  // login, not a redirect. Every write it could reach is gated by the API.
  const member = await getMember();
  const lists = member ? await listsForMember(member.id) : [];

  return <ListsClient initialLists={lists} signedIn={member !== null} />;
}
