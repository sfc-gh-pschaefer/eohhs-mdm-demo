'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { config } from '@/lib/config';
import { IS_HUB } from '@/lib/deployment';
import { terms } from '@/lib/terminology';

/**
 * Sidebar navigation, generated from the entity configuration.
 *
 * The previous version hard-coded one nav section per entity type, which meant a
 * third entity could not appear without editing the component. Here each
 * configured entity contributes a section automatically.
 */

function IconMatching() {
  return (
    <svg className="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconAlerts() {
  return (
    <svg className="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function IconRules() {
  return (
    <svg className="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconReadiness() {
  return (
    <svg className="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

function IconQuality() {
  return (
    <svg className="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="M22 4L12 14.01l-3-3" />
    </svg>
  );
}

function IconPerson() {
  return (
    <svg className="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a7 7 0 0 1 14 0v1" />
    </svg>
  );
}

function IconOverview() {
  return (
    <svg className="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

interface NavEntry {
  href: string;
  label: string;
  icon: React.ReactNode;
}

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  const renderLink = ({ href, label, icon }: NavEntry) => (
    <Link
      key={href}
      href={href}
      className={`nav-item-link${isActive(href) ? ' active' : ''}`}
      aria-current={isActive(href) ? 'page' : undefined}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );

  return (
    <nav className="app-sidebar" aria-label="Main navigation">
      <div className="sidebar-logo">
        <div className="sidebar-brand">
          <div className="sidebar-mark" aria-hidden>{IS_HUB ? 'EOHHS' : 'MH'}</div>
          <div>
            <div className="sidebar-logo-text">{config.title}</div>
            <div className="sidebar-logo-sub">{config.subtitle}</div>
          </div>
        </div>
      </div>

      <div className="sidebar-nav">
        <div className="sidebar-nav-section">Overview</div>
        {renderLink({ href: '/', label: 'Overview', icon: <IconOverview /> })}
        {IS_HUB ? renderLink({ href: '/overlap', label: 'Agency Overlap', icon: <IconReadiness /> }) : null}
        {IS_HUB ? renderLink({ href: '/sharing', label: 'Sharing', icon: <IconMatching /> }) : null}

        {config.entities.map((entity) => (
          <div key={entity.slug}>
            <div className="sidebar-nav-section">Stewardship</div>
            {renderLink({ href: `/${entity.slug}/workbench`, label: 'Steward Workbench', icon: <IconAlerts /> })}
            {renderLink({ href: `/${entity.slug}/360`, label: `${terms.entity} 360`, icon: <IconPerson /> })}
            {renderLink({ href: `/${entity.slug}/matching`, label: 'Matching', icon: <IconMatching /> })}
            {renderLink({ href: `/${entity.slug}/alerts`, label: 'Alerts', icon: <IconAlerts /> })}
            <div className="sidebar-nav-section">Trust &amp; Quality</div>
            {renderLink({ href: `/${entity.slug}/logic`, label: 'Matching Rules', icon: <IconRules /> })}
            {renderLink({ href: `/${entity.slug}/quality`, label: 'Data Quality', icon: <IconQuality /> })}
            {renderLink({ href: `/${entity.slug}/readiness`, label: 'Readiness', icon: <IconReadiness /> })}
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <span className="sf-dot" aria-hidden /> Built on Snowflake
        <div className="sidebar-foot-sub">App Runtime · ML · Cortex AI</div>
      </div>
    </nav>
  );
}
