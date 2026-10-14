export { cn } from './lib/cn';

// Primitives
export { Button, IconButton, buttonVariants, type ButtonProps, type IconButtonProps } from './components/button';
export { Input, type InputProps } from './components/input';
export { Select, type SelectProps } from './components/select';
export { Textarea, type TextareaProps } from './components/textarea';
export { Checkbox, type CheckboxProps } from './components/checkbox';
export { Switch, type SwitchProps } from './components/switch';
export { Label, type LabelProps } from './components/label';
export { Field, type FieldProps } from './components/field';
export { Badge, StatusBadge, type BadgeProps, type BadgeTone, type StatusMap, type StatusBadgeProps } from './components/badge';
export { Card, CardHeader, CardTitle, CardContent, Section, type SectionProps } from './components/card';
export { Tabs, TabPanel, type TabItem, type TabsProps, type TabPanelProps } from './components/tabs';
export { Modal, type ModalProps } from './components/modal';
export { ConfirmDialog, type ConfirmDialogProps } from './components/confirm-dialog';
export { Notice, FieldError, LoadError, type NoticeProps, type NoticeTone } from './components/notice';
export { Spinner, LoadingState, Skeleton, SkeletonRows } from './components/loading';
export { EmptyState, type EmptyStateProps } from './components/empty-state';
export { DropdownMenu, RowActions, type MenuItem, type RowAction, type RowActionsProps, type ConfirmSpec } from './components/dropdown-menu';
export { toasterProps } from './components/toast';

// Page scaffolding
export { AppShell, isActiveHref, SHELL_CONTENT_ID, SHELL_SIDEBAR_ID, type AppShellProps, type ShellNavGroup, type ShellNavItem } from './components/app-shell';
export { PageHeader, type PageHeaderProps } from './components/page-header';
export { BrandScreen, type BrandScreenProps } from './components/brand-screen';
export { StatGrid, StatTile, TotalsBar, type TotalItem } from './components/stats';
export {
  Board,
  BoardFigure,
  BoardFigures,
  BoardRow,
  BoardRows,
  FlapText,
  splitFlapCells,
  type BoardProps,
  type BoardFigureProps,
  type BoardRowProps,
  type BoardRowState,
  type BoardTone,
} from './components/board';

// Data display
export { DataList, type DataColumn, type DataListProps, type MobileRole } from './components/data-list';
export { Pagination, type PaginationProps } from './components/pagination';
export { Money, DateTime, DateOnly, Duration, Phone, FormattersProvider, useFormatters } from './components/format';
export { createFormatters, formatters, formatDuration, defaultDisplaySettings, type DisplaySettings, type Formatters } from './lib/format';

// Search and filters
export { SearchInput, FilterBar, ListEmptyState, type FilterBarProps, type FilterChip, type SearchInputProps } from './components/filter-bar';
export { FilterField, FilterSelect, BranchSelect, DateRangeFilter, MonthFilter, datePresets, type DatePreset, type FilterSelectProps, type DateRangeFilterProps } from './components/filters';
export { Combobox, normalizeArabic, type ComboboxOption, type ComboboxProps } from './components/combobox';
export { useDebouncedValue, SEARCH_DELAY_MS } from './hooks/use-debounced-value';
export { useListState, type ListDefaults, type ListState, type ListStateOptions } from './hooks/use-list-state';
export { useMatchMedia, WIDE_QUERY } from './hooks/use-match-media';

// Links (lets shared components use the app router's Link)
export { UiLinkProvider, useUiLink, type UiLinkProps } from './lib/link';

// Kept for pages not yet migrated (replaced by Pagination / DataList sort headers / MonthFilter)
export { SmartPagination, type SmartPaginationProps } from './components/smart-pagination';
export { SortableTH, type SortableTHProps } from './components/sortable-th';
export { MonthPicker, type MonthPickerProps } from './components/month-picker';
export { AR_MONTH_NAMES, formatMonthValue, isValidMonthValue, parseMonthValue } from './lib/months';
export { getNextSort, type SortDirection, type SortState } from './lib/sort';
