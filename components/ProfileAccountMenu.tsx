'use client';

import { ChevronDown, LogOut } from 'lucide-react';
import { Profile } from '@/lib/supabase';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ProfileAccountMenuProps {
  profile?: Profile;
  fallbackName: string;
  fallbackInitials: string;
  onSignOut: () => Promise<void>;
}

export default function ProfileAccountMenu({
  profile,
  fallbackName,
  fallbackInitials,
  onSignOut,
}: ProfileAccountMenuProps) {
  const fullName = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(' ') || fallbackName;
  const initials = profile?.first_name && profile?.last_name
    ? `${profile.first_name[0]}${profile.last_name[0]}`.toUpperCase()
    : fallbackInitials;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-yellow focus-visible:ring-offset-2 focus-visible:ring-offset-brand-maroon"
          aria-label={`Open account menu for ${fullName}`}
        >
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium leading-tight">Signed in as</div>
            <div className="max-w-40 truncate text-sm text-white/90">{fullName}</div>
          </div>
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-brand-yellow text-sm font-bold text-black shadow-sm">
            {initials}
          </div>
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-white/90 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="w-72 overflow-hidden rounded-2xl border-gray-200 bg-white p-0 text-gray-950 shadow-2xl"
      >
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-brand-maroon text-sm font-bold text-white">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{fullName}</p>
            <p className="truncate text-sm text-gray-500">{profile?.email || 'Account email unavailable'}</p>
          </div>
        </div>

        <DropdownMenuSeparator className="m-0 bg-gray-200" />
        <DropdownMenuItem
          onSelect={() => void onSignOut()}
          className="cursor-pointer gap-3 rounded-none px-5 py-4 text-base font-medium text-red-600 focus:bg-red-50 focus:text-red-700"
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
