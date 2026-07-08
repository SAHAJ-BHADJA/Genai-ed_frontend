'use client';

import { ReactNode, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { LucideIcon, LogOut, ChevronLeft, ChevronRight, Pin, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface NavItem {
  icon: LucideIcon;
  label: string;
  path: string;
  badge?: number;
  comingSoon?: boolean;
}

export interface AddButtonItem {
  type: 'add-button';
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

export type NavSectionItem = NavItem | AddButtonItem | ReactNode;

export interface NavSection {
  title?: string;
  items: NavSectionItem[];
  collapsible?: boolean;
}

interface CollapsibleSidebarProps {
  sections: NavSection[];
  onSignOut?: () => void;
  variant?: 'educator' | 'student';
}

export default function CollapsibleSidebar({
  sections,
  onSignOut,
  variant = 'educator'
}: CollapsibleSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]));

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-pinned');
    if (saved === 'true') {
      setIsPinned(true);
      setIsExpanded(true);
    }
  }, []);

  const handlePinToggle = () => {
    const newPinned = !isPinned;
    setIsPinned(newPinned);
    localStorage.setItem('sidebar-pinned', String(newPinned));
    if (newPinned) {
      setIsExpanded(true);
    }
  };

  const handleMouseEnter = () => {
    if (!isPinned) {
      setIsExpanded(true);
    }
  };

  const handleMouseLeave = () => {
    if (!isPinned) {
      setIsExpanded(false);
    }
  };

  const toggleSection = (index: number) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSections(newExpanded);
  };

  const sidebarWidth = isExpanded ? 'w-64' : 'w-16';

  return (
    <aside
      className={cn(
        'bg-white transition-all duration-300 ease-in-out relative flex flex-col',
        sidebarWidth,
        'min-h-[calc(100vh-80px)]',
        isExpanded ? 'shadow-lg border-r-0' : 'border-r border-gray-200'
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Pin Button */}
      <div className="absolute -right-3 top-6 z-10">
        <button
          onClick={handlePinToggle}
          className={cn(
            'w-7 h-7 rounded-full bg-white border-2 shadow-lg transition-all duration-200 transform hover:scale-110',
            isPinned
              ? 'border-brand-maroon text-brand-maroon bg-red-50'
              : 'border-gray-300 text-gray-400 hover:border-brand-maroon hover:text-brand-maroon',
            'flex items-center justify-center',
            !isExpanded && 'opacity-0 pointer-events-none'
          )}
          title={isPinned ? 'Unpin sidebar' : 'Pin sidebar'}
        >
          <Pin className={cn('w-3.5 h-3.5 transition-transform', isPinned && 'fill-current rotate-45')} />
        </button>
      </div>

      {/* Main Navigation Sections */}
      <div className="flex-1 overflow-y-auto py-4">
        {sections.map((section, sectionIndex) => (
          <div key={sectionIndex} className={sectionIndex > 0 ? 'mt-6' : ''}>
            {section.title && isExpanded && (
              <div className="px-4 mb-2 animate-in fade-in slide-in-from-left-2 duration-300">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider truncate">
                  {section.title}
                </h3>
              </div>
            )}

            <nav className="space-y-1 px-2">
              {section.items.map((item, itemIndex) => {
                // Handle NavItem
                if (typeof item === 'object' && item !== null && 'icon' in item && 'path' in item) {
                  const navItem = item as NavItem;
                  const Icon = navItem.icon;
                  const isActive = pathname === navItem.path;
                  const isComingSoon = navItem.comingSoon;

                  return (
                    <div key={navItem.path} className="relative group">
                      <button
                        onClick={() => router.push(navItem.path)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 transform',
                          isActive
                            ? 'bg-gradient-to-r from-brand-maroon to-red-800 text-white shadow-md scale-[1.02]'
                            : isComingSoon
                              ? 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100 hover:shadow-sm active:scale-[0.98]'
                            : 'text-gray-700 hover:bg-gray-50 hover:shadow-sm active:scale-[0.98]',
                          !isExpanded && 'justify-center'
                        )}
                      >
                        <Icon className={cn(
                          'w-5 h-5 flex-shrink-0',
                          isActive && 'drop-shadow-sm',
                          isComingSoon && !isActive && 'text-amber-700'
                        )} />
                        {isExpanded && (
                          <>
                            <span className="font-medium text-sm truncate flex-1 text-left">
                              {navItem.label}
                            </span>
                            {isComingSoon && !isActive && (
                              <span className="ml-auto px-2 py-0.5 bg-amber-200 text-amber-900 text-[10px] font-bold rounded-full flex-shrink-0">
                                Soon
                              </span>
                            )}
                            {navItem.badge && navItem.badge > 0 && (
                              <span className="ml-auto px-2 py-0.5 bg-brand-yellow text-black text-xs font-bold rounded-full flex-shrink-0 shadow-sm animate-pulse">
                                {navItem.badge}
                              </span>
                            )}
                          </>
                        )}
                      </button>

                      {/* Tooltip when collapsed */}
                      {!isExpanded && (
                        <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 delay-300 pointer-events-none whitespace-nowrap z-50 shadow-xl">
                          {navItem.label}
                          <div className="absolute right-full top-1/2 -translate-y-1/2 border-[6px] border-transparent border-r-gray-900" />
                        </div>
                      )}
                    </div>
                  );
                }

                // Handle AddButtonItem
                if (typeof item === 'object' && item !== null && 'type' in item && item.type === 'add-button') {
                  const addButton = item as AddButtonItem;
                  const ButtonIcon = addButton.icon || Plus;

                  return (
                    <div key={`add-button-${itemIndex}`} className="relative group">
                      {isExpanded ? (
                        // Expanded: Show full button with text and dashed border
                        <button
                          onClick={addButton.onClick}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-gray-300 text-gray-600 hover:border-brand-maroon hover:text-brand-maroon hover:bg-red-50 transition-all duration-200 text-sm font-medium transform hover:scale-[1.02] active:scale-[0.98]"
                        >
                          <ButtonIcon className="w-4 h-4 font-bold" strokeWidth={2.5} />
                          <span>{addButton.label}</span>
                        </button>
                      ) : (
                        // Collapsed: Show compact circular "+" button
                        <>
                          <button
                            onClick={addButton.onClick}
                            className="w-full flex items-center justify-center px-3 py-2.5 transition-all duration-200"
                          >
                            <div className="w-9 h-9 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-600 hover:border-brand-maroon hover:text-brand-maroon hover:bg-red-50 transition-all duration-200 transform hover:scale-110 active:scale-95">
                              <ButtonIcon className="w-5 h-5" strokeWidth={2.5} />
                            </div>
                          </button>

                          {/* Tooltip when collapsed */}
                          <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 delay-300 pointer-events-none whitespace-nowrap z-50 shadow-xl">
                            {addButton.label}
                            <div className="absolute right-full top-1/2 -translate-y-1/2 border-[6px] border-transparent border-r-gray-900" />
                          </div>
                        </>
                      )}
                    </div>
                  );
                }

                // Handle custom ReactNode (only if it's a valid React element)
                if (typeof item === 'object' && item !== null && 'type' in item) {
                  return (
                    <div key={itemIndex}>
                      {item as ReactNode}
                    </div>
                  );
                }

                return null;
              })}
            </nav>
          </div>
        ))}
      </div>

      {/* Sign Out Button */}
      {onSignOut && (
        <div className="border-t border-gray-200 p-2">
          <div className="relative group">
            <button
              onClick={onSignOut}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-600 hover:bg-red-50 transition-all duration-200',
                !isExpanded && 'justify-center'
              )}
            >
              <LogOut className="w-5 h-5 flex-shrink-0" />
              {isExpanded && (
                <span className="font-medium text-sm truncate">Sign Out</span>
              )}
            </button>

            {!isExpanded && (
              <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 delay-300 pointer-events-none whitespace-nowrap z-50 shadow-xl">
                Sign Out
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-[6px] border-transparent border-r-gray-900" />
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
