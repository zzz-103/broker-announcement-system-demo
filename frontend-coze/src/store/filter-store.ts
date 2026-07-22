import { create } from "zustand";

export type TimeRange = "30d" | "90d" | "year" | "all";

interface FilterStore {
  search: string;
  timeRange: TimeRange;
  brokerNames: string[];
  primaryDomain: string;
  announcementStage: string;
  procurementMethod: string;
  finTechOnly: boolean;
  // detail filter (from card clicks)
  detailFilter: Record<string, string> | null;

  setSearch: (v: string) => void;
  setTimeRange: (v: TimeRange) => void;
  setBrokerNames: (v: string[]) => void;
  toggleBrokerName: (name: string) => void;
  setPrimaryDomain: (v: string) => void;
  setAnnouncementStage: (v: string) => void;
  setProcurementMethod: (v: string) => void;
  setFinTechOnly: (v: boolean) => void;
  setDetailFilter: (v: Record<string, string> | null) => void;
  resetAll: () => void;
}

const INITIAL = {
  search: "",
  timeRange: "90d" as TimeRange,
  brokerNames: [] as string[],
  primaryDomain: "",
  announcementStage: "",
  procurementMethod: "",
  finTechOnly: true,
  detailFilter: null as Record<string, string> | null,
};

export const useFilterStore = create<FilterStore>((set) => ({
  ...INITIAL,
  setSearch: (v) => set({ search: v }),
  setTimeRange: (v) => set({ timeRange: v }),
  setBrokerNames: (v) => set({ brokerNames: v }),
  toggleBrokerName: (name) =>
    set((state) => ({
      brokerNames: state.brokerNames.includes(name)
        ? state.brokerNames.filter((n) => n !== name)
        : [...state.brokerNames, name],
    })),
  setPrimaryDomain: (v) => set({ primaryDomain: v }),
  setAnnouncementStage: (v) => set({ announcementStage: v }),
  setProcurementMethod: (v) => set({ procurementMethod: v }),
  setFinTechOnly: (v) => set({ finTechOnly: v }),
  setDetailFilter: (v) => set({ detailFilter: v }),
  resetAll: () => set(INITIAL),
}));

