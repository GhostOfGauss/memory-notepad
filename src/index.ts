#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Define memory file path using environment variable with fallback
const defaultMemoryPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "memory.json"
);

// If MEMORY_FILE_PATH is just a filename, put it in the same directory as the script
const MEMORY_FILE_PATH = process.env.MEMORY_FILE_PATH
  ? path.isAbsolute(process.env.MEMORY_FILE_PATH)
    ? process.env.MEMORY_FILE_PATH
    : path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        process.env.MEMORY_FILE_PATH
      )
  : defaultMemoryPath;

// We are storing our memory using notes and observations
interface Note {
  name: string;
  noteType: string;
  observations: string[];
}

interface Notepad {
  notes: Note[];
}

// The NotepadManager class contains all operations to interact with the notepad
class NotepadManager {
  private async loadNotepad(): Promise<Notepad> {
    try {
      const data = await fs.readFile(MEMORY_FILE_PATH, "utf-8");
      const lines = data.split("\n").filter((line) => line.trim() !== "");
      return lines.reduce(
        (notepad: Notepad, line) => {
          const item = JSON.parse(line);
          if (item.type === "note") notepad.notes.push(item as Note);
          return notepad;
        },
        { notes: [] }
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as any).code === "ENOENT"
      ) {
        return { notes: [] };
      }
      throw error;
    }
  }

  private async saveNotepad(notepad: Notepad): Promise<void> {
    const lines = [
      ...notepad.notes.map((e) => JSON.stringify({ type: "note", ...e })),
    ];
    await fs.writeFile(MEMORY_FILE_PATH, lines.join("\n"));
  }

  async createNotes(notes: Note[]): Promise<Note[]> {
    const notepad = await this.loadNotepad();
    const newNotes = notes.filter(
      (e) => !notepad.notes.some((existingNote) => existingNote.name === e.name)
    );
    notepad.notes.push(...newNotes);
    await this.saveNotepad(notepad);
    return newNotes;
  }

  async addObservations(
    observations: { noteName: string; contents: string[] }[]
  ): Promise<{ noteName: string; addedObservations: string[] }[]> {
    const notepad = await this.loadNotepad();
    const results = observations.map((o) => {
      const note = notepad.notes.find((e) => e.name === o.noteName);
      if (!note) {
        throw new Error(`Note with name ${o.noteName} not found`);
      }
      const newObservations = o.contents.filter(
        (content) => !note.observations.includes(content)
      );
      note.observations.push(...newObservations);
      return { noteName: o.noteName, addedObservations: newObservations };
    });
    await this.saveNotepad(notepad);
    return results;
  }

  async deleteNotes(noteNames: string[]): Promise<void> {
    const notepad = await this.loadNotepad();
    notepad.notes = notepad.notes.filter((e) => !noteNames.includes(e.name));
    await this.saveNotepad(notepad);
  }

  async deleteObservations(
    deletions: { noteName: string; observations: string[] }[]
  ): Promise<void> {
    const notepad = await this.loadNotepad();
    deletions.forEach((d) => {
      const note = notepad.notes.find((e) => e.name === d.noteName);
      if (note) {
        note.observations = note.observations.filter(
          (o) => !d.observations.includes(o)
        );
      }
    });
    await this.saveNotepad(notepad);
  }

  async readNotepad(): Promise<Notepad> {
    return this.loadNotepad();
  }

  // Very basic search function
  async searchNotes(query: string): Promise<Notepad> {
    const notepad = await this.loadNotepad();

    // Filter notes
    const filteredNotes = notepad.notes.filter(
      (e) =>
        e.name.toLowerCase().includes(query.toLowerCase()) ||
        e.noteType.toLowerCase().includes(query.toLowerCase()) ||
        e.observations.some((o) =>
          o.toLowerCase().includes(query.toLowerCase())
        )
    );

    const filteredNotepad: Notepad = {
      notes: filteredNotes,
    };

    return filteredNotepad;
  }

  async openNotes(names: string[]): Promise<Notepad> {
    const notepad = await this.loadNotepad();

    // Filter notes
    const filteredNotes = notepad.notes.filter((e) => names.includes(e.name));

    const filteredNotepad: Notepad = {
      notes: filteredNotes,
    };

    return filteredNotepad;
  }
}

const notepadManager = new NotepadManager();

// The server instance and tools exposed to Claude
const server = new Server(
  {
    name: "memory-notepad",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_notes",
        description: "Create multiple new notes in the notepad",
        inputSchema: {
          type: "object",
          properties: {
            notes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    description: "The name of the note",
                  },
                  noteType: {
                    type: "string",
                    description: "The type of the note",
                  },
                  observations: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "An array of observation contents associated with the note",
                  },
                },
                required: ["name", "noteType", "observations"],
              },
            },
          },
          required: ["notes"],
        },
      },
      {
        name: "add_observations",
        description: "Add new observations to existing notes in the notepad",
        inputSchema: {
          type: "object",
          properties: {
            observations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  noteName: {
                    type: "string",
                    description:
                      "The name of the note to add the observations to",
                  },
                  contents: {
                    type: "array",
                    items: { type: "string" },
                    description: "An array of observation contents to add",
                  },
                },
                required: ["noteName", "contents"],
              },
            },
          },
          required: ["observations"],
        },
      },
      {
        name: "delete_notes",
        description: "Delete multiple notes from the notepad",
        inputSchema: {
          type: "object",
          properties: {
            noteNames: {
              type: "array",
              items: { type: "string" },
              description: "An array of note names to delete",
            },
          },
          required: ["noteNames"],
        },
      },
      {
        name: "delete_observations",
        description: "Delete specific observations from notes in the notepad",
        inputSchema: {
          type: "object",
          properties: {
            deletions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  noteName: {
                    type: "string",
                    description:
                      "The name of the note containing the observations",
                  },
                  observations: {
                    type: "array",
                    items: { type: "string" },
                    description: "An array of observations to delete",
                  },
                },
                required: ["noteName", "observations"],
              },
            },
          },
          required: ["deletions"],
        },
      },
      {
        name: "read_notepad",
        description: "Read the entire notepad",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "search_notes",
        description: "Search for notes in the notepad based on a query",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "The search query to match against note names, types, and observation content",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "open_notes",
        description: "Open specific notes in the notepad by their names",
        inputSchema: {
          type: "object",
          properties: {
            names: {
              type: "array",
              items: { type: "string" },
              description: "An array of note names to retrieve",
            },
          },
          required: ["names"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new Error(`No arguments provided for tool: ${name}`);
  }

  switch (name) {
    case "create_notes":
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await notepadManager.createNotes(args.notes as Note[]),
              null,
              2
            ),
          },
        ],
      };
    case "add_observations":
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await notepadManager.addObservations(
                args.observations as {
                  noteName: string;
                  contents: string[];
                }[]
              ),
              null,
              2
            ),
          },
        ],
      };
    case "delete_notes":
      await notepadManager.deleteNotes(args.noteNames as string[]);
      return {
        content: [{ type: "text", text: "Notes deleted successfully" }],
      };
    case "delete_observations":
      await notepadManager.deleteObservations(
        args.deletions as { noteName: string; observations: string[] }[]
      );
      return {
        content: [{ type: "text", text: "Observations deleted successfully" }],
      };
    case "read_notepad":
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(await notepadManager.readNotepad(), null, 2),
          },
        ],
      };
    case "search_notes":
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await notepadManager.searchNotes(args.query as string),
              null,
              2
            ),
          },
        ],
      };
    case "open_notes":
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await notepadManager.openNotes(args.names as string[]),
              null,
              2
            ),
          },
        ],
      };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Notepad MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
