import { newId, type ServiceRecord } from "@cmp/database";
import { AppError } from "@cmp/shared-types";
import type { LiveState, ServiceData, ServiceDetail, ServiceItemData } from "@cmp/shared-types";
import { serviceItemOptionsSchema, type EngineConfig, type EngineDocument } from "@cmp/shared-validation";
import type { LiveRuntime } from "../live/live-runtime";
import type { PlaylistItem } from "../live/live-session";
import type { Logger } from "../logging/logger";
import type { SongService } from "../songs/song-service";
import type { WorkspaceManager } from "../workspace/workspace-manager";
import { resolveServiceItem, type ResolverDeps } from "./service-resolver";
import { BUILT_IN_SERVICE_TEMPLATES, type ServiceTemplateDefinition, type TemplateItem } from "./templates";

export interface ServiceServiceOptions {
  workspaces: WorkspaceManager;
  songs: SongService;
  scripture(translation: string, reference: string, onePerSlide: boolean): Promise<EngineDocument>;
  live: LiveRuntime;
  engineConfig(): Promise<EngineConfig>;
  logger: Logger;
}

/**
 * Service planning (DOCUMENTATION.md §8): templates, saving, duplicating,
 * the full-programme preview and starting a service live (§3.2).
 */
export function createServiceService(options: ServiceServiceOptions) {
  const { workspaces, logger } = options;
  const repo = () => workspaces.require().services;

  function toDetail(record: ServiceRecord): ServiceDetail {
    return {
      ...record,
      items: record.items.map((item) => ({
        ...item,
        // Stored options were validated on write; re-parse to fill defaults.
        options: serviceItemOptionsSchema.parse(item.options),
      })) as ServiceItemData[],
    };
  }

  async function require(id: string): Promise<ServiceRecord> {
    const record = await repo().get(id);
    if (!record) throw new AppError("NOT_FOUND", "Service not found");
    return record;
  }

  function fromTemplate(definition: ServiceTemplateDefinition): Pick<ServiceData, "groups" | "items"> {
    const groups = new Map<string, string>();
    const items = definition.items.map((entry: TemplateItem) => {
      let groupId: string | null = null;
      if (entry.group) {
        groupId = groups.get(entry.group) ?? newId();
        groups.set(entry.group, groupId);
      }
      return {
        id: newId(),
        groupId,
        itemType: entry.itemType,
        refId: null,
        options: serviceItemOptionsSchema.parse(entry.options),
        label: entry.label,
        notes: null,
      };
    });
    return { groups: [...groups].map(([name, id]) => ({ id, name })), items };
  }

  function resolverDeps(): ResolverDeps {
    const workspace = workspaces.require();
    return {
      workspace,
      songDocument: async (songId, overrides) => {
        const song = await options.songs.get(songId);
        return options.songs.generate(song.id, {
          ...song,
          templateId: overrides.templateId ?? song.templateId,
          backgroundAssetId: overrides.backgroundAssetId ?? song.backgroundAssetId,
        });
      },
      scriptureDocument: options.scripture,
      logo: async () => {
        const config = await options.engineConfig();
        return { src: config.logoSrc, text: config.logoText };
      },
    };
  }

  async function resolveAll(record: ServiceRecord) {
    const deps = resolverDeps();
    const detail = toDetail(record);
    return Promise.all(detail.items.map(async (item) => ({ item, resolved: await resolveServiceItem(item, deps) })));
  }

  return {
    async list() {
      return repo().list();
    },

    async get(id: string): Promise<ServiceDetail> {
      return toDetail(await require(id));
    },

    async create(input: {
      title: string;
      serviceDate?: string | null | undefined;
      startTime?: string | null | undefined;
      templateId?: string | null | undefined;
    }): Promise<ServiceDetail> {
      let definition: ServiceTemplateDefinition = { serviceType: "custom", items: [] };
      if (input.templateId) {
        const builtIn = BUILT_IN_SERVICE_TEMPLATES.find((template) => template.id === input.templateId);
        const custom = builtIn ? null : (await repo().templates()).find((template) => template.id === input.templateId);
        if (!builtIn && !custom) throw new AppError("NOT_FOUND", "Template not found");
        definition = builtIn ? builtIn.definition : (custom!.definition as ServiceTemplateDefinition);
      }
      const { groups, items } = fromTemplate(definition);
      return toDetail(
        await repo().create({
          title: input.title,
          serviceType: definition.serviceType,
          serviceDate: input.serviceDate ?? null,
          startTime: input.startTime ?? null,
          theme: null,
          description: null,
          groups,
          items,
        }),
      );
    },

    async save(id: string, data: ServiceData): Promise<ServiceDetail> {
      return toDetail(await repo().save(id, data));
    },

    async duplicate(id: string, serviceDate: string | null): Promise<ServiceDetail> {
      return toDetail(await repo().duplicate(id, serviceDate));
    },

    async delete(id: string): Promise<void> {
      if (options.live.controller.state().service?.id === id) {
        throw new AppError("LIVE_SESSION_ACTIVE", "This service is running. End the live session first.");
      }
      await repo().delete(id);
    },

    async templates() {
      const custom = await repo().templates();
      return [
        ...BUILT_IN_SERVICE_TEMPLATES.map((template) => ({
          id: template.id,
          name: template.name,
          description: template.description,
          itemCount: template.definition.items.length,
          builtIn: true,
        })),
        ...custom.map((template) => ({
          id: template.id,
          name: template.name,
          description: "Saved from a service",
          itemCount: (template.definition as ServiceTemplateDefinition).items?.length ?? 0,
          builtIn: false,
        })),
      ];
    },

    /** Saves a service's running order (without its content) as a template. */
    async saveTemplate(id: string, name: string) {
      const detail = toDetail(await require(id));
      const groupNames = new Map(detail.groups.map((group) => [group.id, group.name]));
      const definition: ServiceTemplateDefinition = {
        serviceType: detail.serviceType ?? "custom",
        items: detail.items.map((item) => ({
          itemType: item.itemType,
          label: item.label ?? item.itemType,
          options: item.options,
          ...(item.groupId && groupNames.has(item.groupId) ? { group: groupNames.get(item.groupId)! } : {}),
        })),
      };
      return repo().saveTemplate(name, definition);
    },

    /** The full programme, resolved item by item (§8.2 preview). */
    async preview(id: string) {
      const results = await resolveAll(await require(id));
      return results.map(({ item, resolved }) =>
        resolved.ok
          ? { itemId: item.id, title: resolved.item.title, problem: null, slideCount: resolved.item.doc.slides.length, doc: resolved.item.doc }
          : { itemId: item.id, title: resolved.title, problem: resolved.problem, slideCount: 0, doc: null },
      );
    },

    /** Resolves the service and runs it live (§3.2). */
    async start(id: string, startAt?: { itemIndex: number; slideIndex: number }): Promise<LiveState> {
      const record = await require(id);
      const results = await resolveAll(record);
      const items: PlaylistItem[] = [];
      const problems: { code: string; message: string }[] = [];
      for (const { resolved } of results) {
        if (resolved.ok) items.push(resolved.item);
        else problems.push({ code: "ITEM_SKIPPED", message: `Skipped “${resolved.title}”: ${resolved.problem}` });
      }
      if (items.length === 0) {
        throw new AppError("VALIDATION_ERROR", "Nothing in this service can be shown yet", { problems });
      }
      const state = await options.live.start(startAt, { id: record.id, title: record.title, items, problems });
      await repo().setStatus(record.id, "live");
      logger.info(`[services] “${record.title}” live: ${items.length} items, ${problems.length} skipped`);
      return state;
    },

    /** Called when a live session ends: mark its service completed. */
    async sessionEnded(serviceId: string | undefined): Promise<void> {
      if (serviceId) await repo().setStatus(serviceId, "completed").catch(() => undefined);
    },
  };
}

export type ServiceService = ReturnType<typeof createServiceService>;
