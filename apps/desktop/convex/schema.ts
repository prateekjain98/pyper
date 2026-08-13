import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The desktop wire contract carries snake_case fields and allows explicit null
// on most columns. We store them verbatim so the HTTP handlers stay a thin
// pass-through (see ./http.ts). Every row is scoped to `ownerSubject` — the
// better-auth user id taken from the JWT `sub` claim (CloudNote.user_id).
const nstr = v.union(v.string(), v.null());
const nnum = v.union(v.number(), v.null());

export default defineSchema({
  notes: defineTable({
    ownerSubject: v.string(),
    client_note_id: v.string(),
    title: nstr,
    content: v.string(),
    enhanced_content: nstr,
    enhancement_prompt: nstr,
    enhanced_at_content_hash: nstr,
    note_type: v.string(), // "personal" | "meeting" | "upload"
    source_file: nstr,
    audio_duration_seconds: nnum,
    participants: nstr,
    calendar_event_id: nstr,
    diarization_enabled: nnum,
    expected_speaker_count: nnum,
    transcript: nstr,
    folder_id: nstr, // cloud folder id (Convex _id string) or null
    workspace_id: nstr,
    space_id: nstr,
    updated_by_user_id: nstr,
    previous_space_id: v.optional(nstr),
    deleted_at: nstr, // tombstone timestamp (soft delete) or null
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_owner_client", ["ownerSubject", "client_note_id"])
    .index("by_owner_updated", ["ownerSubject", "updated_at"]) // delta pull (since)
    .index("by_owner_created", ["ownerSubject", "created_at"]) // snapshot pull (before)
    .index("by_space_updated", ["space_id", "updated_at"]) // space-shared content (members)
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["ownerSubject", "deleted_at"],
    }),

  folders: defineTable({
    ownerSubject: v.string(),
    client_folder_id: v.string(),
    name: v.string(),
    is_default: v.boolean(),
    sort_order: v.number(),
    workspace_id: nstr,
    space_id: nstr,
    previous_space_id: v.optional(nstr),
    deleted_at: nstr,
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_owner_client", ["ownerSubject", "client_folder_id"])
    .index("by_owner_updated", ["ownerSubject", "updated_at"])
    .index("by_owner_space_name", ["ownerSubject", "space_id", "name"]) // folder_name_taken check
    .index("by_space_updated", ["space_id", "updated_at"]), // space-shared content (members)

  transcriptions: defineTable({
    ownerSubject: v.string(),
    client_transcription_id: v.string(),
    text: v.string(),
    raw_text: nstr,
    provider: nstr,
    model: nstr,
    language: nstr,
    audio_duration_ms: nnum,
    status: nstr,
    word_count: v.optional(nnum),
    source: v.optional(nstr),
    deleted_at: nstr,
    created_at: v.string(),
    updated_at: v.optional(v.string()),
  })
    .index("by_owner_client", ["ownerSubject", "client_transcription_id"])
    .index("by_owner_created", ["ownerSubject", "created_at"])
    .index("by_owner_updated", ["ownerSubject", "updated_at"]),

  dictionary: defineTable({
    ownerSubject: v.string(),
    client_dict_id: v.string(),
    word: v.string(),
    source: v.string(), // "manual" | "learned"
    deleted_at: nstr,
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_owner_client", ["ownerSubject", "client_dict_id"])
    .index("by_owner_updated", ["ownerSubject", "updated_at"]),

  snippets: defineTable({
    ownerSubject: v.string(),
    client_snippet_id: v.string(),
    trigger: v.string(), // server caps at 100 chars (see database.js MAX_SNIPPET_TRIGGER_LENGTH)
    replacement: v.string(),
    deleted_at: nstr,
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_owner_client", ["ownerSubject", "client_snippet_id"])
    .index("by_owner_updated", ["ownerSubject", "updated_at"]),

  conversations: defineTable({
    ownerSubject: v.string(),
    client_conversation_id: v.string(),
    title: nstr,
    archived_at: nstr,
    deleted_at: nstr,
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_owner_client", ["ownerSubject", "client_conversation_id"])
    .index("by_owner_updated", ["ownerSubject", "updated_at"]),

  conversationMessages: defineTable({
    ownerSubject: v.string(),
    conversation_id: v.id("conversations"),
    role: v.string(),
    content: v.string(),
    metadata: v.optional(v.any()),
    created_at: v.string(),
  }).index("by_conversation", ["conversation_id", "created_at"]),

  // TODO(teams): spaces/teams/workspaces/memberships/ACL are a large second
  // phase (see README "Teams & spaces"). These minimal tables exist so
  // GET /api/me/spaces can return an empty roster during the personal-scope
  // migration without 500-ing the sync pass.
  spaces: defineTable({
    workspace_id: v.string(),
    created_by: v.string(), // subject of the creator (owner)
    name: v.string(),
    slug: nstr,
    description: nstr,
    emoji: nstr,
    deleted_at: nstr,
    created_at: v.string(),
    updated_at: v.string(),
  }).index("by_workspace", ["workspace_id"]),

  spaceMembers: defineTable({
    space_id: v.id("spaces"),
    subject: v.string(), // better-auth user id
    role: v.string(),
  })
    .index("by_subject", ["subject"])
    .index("by_space", ["space_id"]),
});
