import { Kbd } from '../../components/primitives';
import { Modal } from '../../components/overlay';
import { hotkeyText, listHotkeys } from '../../lib/hotkeys';
import { t } from "../../lib/i18n";

const EDITOR_SHORTCUTS: {
    combo: string;
    description: () => string;
}[] = [
    { combo: 'mod+b', description: () => t("common.bold") },
    { combo: 'mod+i', description: () => t("common.italic") },
    { combo: 'mod+e', description: () => t("common.inline_code") },
    { combo: 'mod+shift+x', description: () => t("common.strikethrough") },
    { combo: 'mod+shift+h', description: () => t("common.highlight") },
    { combo: 'mod+1', description: () => t("command.heading_1_same_pattern_for_2_6") },
    { combo: 'mod+shift+8', description: () => t("common.unordered_list") },
    { combo: 'mod+shift+7', description: () => t("common.ordered_list") },
    { combo: 'mod+shift+9', description: () => t("common.task_list") },
    { combo: 'mod+shift+.', description: () => t("common.quote") },
    { combo: 'mod+shift+enter', description: () => t("command.check_uncheck_tasks") },
    { combo: 'alt+arrowup', description: () => t("command.move_line_up") },
    { combo: 'alt+arrowdown', description: () => t("command.move_line_down") },
    { combo: 'mod+shift+k', description: () => t("command.delete_line") },
    { combo: 'mod+f', description: () => t("command.find_and_replace_in_this_note") },
    { combo: 'mod+z', description: () => t("common.undo") },
    { combo: 'mod+shift+z', description: () => t("command.redo") },
];
const INPUT_HINTS: {
    keys: string[];
    description: () => string;
}[] = [
    { keys: ['[', '['], description: () => t("command.link_to_another_note_autocomplete") },
    { keys: ['#'], description: () => t("command.insert_tag_autocomplete") },
    { keys: ['`', '`', '`'], description: () => t("command.code_block_language_autocomplete") },
    { keys: ['↵'], description: () => t("command.continue_lists_automatically_press_enter_on_an_empty_item_to_exit") },
    { keys: ['Tab'], description: () => t("command.jump_to_the_next_cell_in_the_table") },
];
export function ShortcutsPanel({ onClose }: {
    onClose: () => void;
}) {
    const groups = (() => {
        const registered = listHotkeys();
        const map = new Map<string, {
            combo: string;
            description: string;
        }[]>();
        for (const hotkey of registered) {
            const group = hotkeyText(hotkey.group);
            const list = map.get(group) ?? [];
            list.push({ combo: hotkey.combo, description: hotkeyText(hotkey.description) });
            map.set(group, list);
        }
        map.set(t("common.edit"), [
            ...(map.get(t("common.edit")) ?? []),
            ...EDITOR_SHORTCUTS.map((item) => ({ ...item, description: item.description() })),
        ]);
        return [...map.entries()];
    })();
    return (<Modal open onClose={onClose} title={t("command.keyboard_shortcuts_021cf9")} description={t("command.use_nearly_every_action_without_touching_the_mouse")} width={720}>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 pr-1 md:max-h-[62vh] md:grid-cols-2 md:overflow-y-auto">
        {groups.map(([group, items]) => (<section key={group}>
            <h3 className="mb-2 text-[10.5px] font-semibold tracking-[0.07em] text-[var(--text-quaternary)]">
              {group}
            </h3>
            <ul className="space-y-0.5">
              {items.map((item, index) => (<li key={`${item.combo}-${index}`} className="flex min-h-10 items-center justify-between gap-4 rounded-[var(--r-sm)] px-1.5 py-[5px] transition-colors hover:bg-[var(--bg-hover)] md:min-h-0">
                  <span className="min-w-0 text-[12.5px] leading-snug text-[var(--text-secondary)] md:truncate">
                    {item.description}
                  </span>
                  <Kbd combo={item.combo}/>
                </li>))}
            </ul>
          </section>))}

        <section>
          <h3 className="mb-2 text-[10.5px] font-semibold tracking-[0.07em] text-[var(--text-quaternary)]">{t("command.triggered_as_you_type")}</h3>
          <ul className="space-y-0.5">
            {INPUT_HINTS.map((item, index) => (<li key={index} className="flex min-h-10 items-center justify-between gap-4 rounded-[var(--r-sm)] px-1.5 py-[5px] transition-colors hover:bg-[var(--bg-hover)] md:min-h-0">
                <span className="min-w-0 text-[12.5px] leading-snug text-[var(--text-secondary)] md:truncate">
                  {item.description()}
                </span>
                <Kbd keys={item.keys}/>
              </li>))}
          </ul>
        </section>
      </div>
    </Modal>);
}
