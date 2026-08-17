import type * as React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

function CustomSidebarLayout({
  className,
  style,
  ...props
}: React.ComponentProps<typeof SidebarProvider>) {
  return (
    <SidebarProvider
      className={cn("settings-layout", className)}
      defaultOpen
      style={
        {
          "--sidebar-width": "200px",
          "--sidebar-width-icon": "48px",
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

function CustomSidebar({
  className,
  innerClassName,
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar
      collapsible="none"
      className={cn("harday-section-sidebar", className)}
      innerClassName={cn("harday-section-sidebar-inner", innerClassName)}
      {...props}
    />
  );
}

function CustomSidebarMenuButton({
  className,
  isActive,
  ...props
}: React.ComponentProps<typeof SidebarMenuButton>) {
  return (
    <SidebarMenuButton
      isActive={isActive}
      className={cn(
        "harday-section-sidebar-button",
        isActive && "harday-section-sidebar-button-active",
        className,
      )}
      {...props}
    />
  );
}

export {
  CustomSidebar,
  CustomSidebarLayout,
  CustomSidebarMenuButton,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
};
