import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import type { SettingsNavItem, SettingsNavSection } from "@opaline/ui";
import { SparSectionLabel, SparSidebarRow, SparSidebarSearch } from "../../components/spar";
import { ConstructSidebarSurface } from "./ConstructSidebarSurface";

/**
 * The settings sidebar, on the same composition as every other one.
 *
 * It used to be its own structure entirely — its own gutters, its own search
 * field, its own section spacing — so moving between Settings and anywhere else
 * shifted every row a few pixels sideways and changed the size of the text in
 * them. There is nothing special about a list of settings pages: it is a list of
 * rows with labels over groups of them, which is what the shared surface draws.
 *
 * Filtering happens here rather than in the page, because the page's job is to
 * render the item you picked and the sidebar's is to help you pick it. An empty
 * result says so rather than showing a blank column.
 */
export function ConstructSettingsSidebar({
  activeItemId,
  backLabel = "Back to app",
  footer,
  onBack,
  onItemSelect,
  onSearchChange,
  query,
  sections,
}: {
  activeItemId: string;
  backLabel?: string;
  footer: ReactNode;
  onBack: () => void;
  onItemSelect: (item: SettingsNavItem) => void;
  onSearchChange: (query: string) => void;
  query: string;
  sections: SettingsNavSection[];
}) {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? sections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => String(item.label).toLowerCase().includes(needle)),
        }))
        .filter((section) => section.items.length > 0)
    : sections;

  return (
    <ConstructSidebarSurface
      actions={[
        {
          id: "back",
          icon: <ArrowLeft />,
          label: backLabel,
          onClick: onBack,
        },
      ]}
      footer={footer}
    >
      <div className="pb-2">
        <SparSidebarSearch
          ariaLabel="Search settings"
          onChange={onSearchChange}
          placeholder="Search settings"
          value={query}
        />
      </div>

      {filtered.map((section) => (
        <div key={section.id ?? String(section.label)}>
          <SparSectionLabel>{section.label}</SparSectionLabel>
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <SparSidebarRow
                active={activeItemId === item.id}
                key={item.id}
                label={String(item.label)}
                leading={
                  item.icon ? (
                    <span className="grid size-3.5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.5">
                      {item.icon}
                    </span>
                  ) : undefined
                }
                onOpen={() => onItemSelect(item)}
              />
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <p className="px-2 pt-4 text-center text-ui text-muted-foreground/60">
          {`Nothing matches “${query.trim()}”`}
        </p>
      )}
    </ConstructSidebarSurface>
  );
}
