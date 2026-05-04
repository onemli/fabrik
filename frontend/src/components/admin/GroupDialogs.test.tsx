/**
 * Group Management Dialogs Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateGroupDialog } from './CreateGroupDialog'
import { DeleteGroupDialog } from './DeleteGroupDialog'
import { userManagementService } from '@/services/userManagement'
import type { GroupDetail } from '@/services/userManagement'

// Mock dependencies
vi.mock('@/services/userManagement')
vi.mock('@/store/queryBuilderStore', () => ({
  useQueryBuilderStore: () => ({
    showLogoNotification: vi.fn(),
  }),
}))

const mockPermissions = [
  {
    id: 1,
    name: 'Can add query',
    codename: 'add_query',
    category: 'Queries',
    description: 'Permission to add new queries',
    is_dangerous: false,
    content_type: {
      id: 1,
      app_label: 'mim',
      model: 'query',
    },
  },
  {
    id: 2,
    name: 'Can change query',
    codename: 'change_query',
    category: 'Queries',
    description: 'Permission to modify queries',
    is_dangerous: false,
    content_type: {
      id: 1,
      app_label: 'mim',
      model: 'query',
    },
  },
  {
    id: 3,
    name: 'Can delete query',
    codename: 'delete_query',
    category: 'Queries',
    description: 'Permission to delete queries',
    is_dangerous: true,
    content_type: {
      id: 1,
      app_label: 'mim',
      model: 'query',
    },
  },
]

const mockRoleTemplates = {
  viewer: {
    name: 'Viewer',
    description: 'Read-only access to queries',
    permission_ids: [1],
    icon: 'Eye',
    color: 'blue',
  },
  editor: {
    name: 'Editor',
    description: 'Can create and modify queries',
    permission_ids: [1, 2],
    icon: 'Edit',
    color: 'green',
  },
}

const mockGroup: GroupDetail = {
  id: 2,
  name: 'Editors',
  permissions: [mockPermissions[0], mockPermissions[1]],
  user_count: 3,
  users: [
    {
      id: 1,
      username: 'editor1',
      email: 'editor1@test.com',
      is_active: true,
    },
    {
      id: 2,
      username: 'editor2',
      email: 'editor2@test.com',
      is_active: true,
    },
  ],
}

const mockAdminGroup: GroupDetail = {
  id: 1,
  name: 'Admin',
  permissions: mockPermissions,
  user_count: 1,
  users: [
    {
      id: 1,
      username: 'admin',
      email: 'admin@test.com',
      is_active: true,
    },
  ],
}

describe('CreateGroupDialog', () => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(userManagementService.listPermissions).mockResolvedValue({
      count: 3,
      next: null,
      previous: null,
      results: mockPermissions,
    })
    vi.mocked(userManagementService.getRoleTemplates).mockResolvedValue(mockRoleTemplates)
  })

  it('should render create group form', async () => {
    render(
      <CreateGroupDialog open={true} onClose={onClose} onSuccess={onSuccess} />
    )

    await waitFor(() => {
      expect(screen.getByText('Create New Group')).toBeInTheDocument()
    })

    expect(screen.getByLabelText('Group Name *')).toBeInTheDocument()
    expect(screen.getByText('Permissions')).toBeInTheDocument()
  })

  it('should load and display permissions in PermissionSelector', async () => {
    render(
      <CreateGroupDialog open={true} onClose={onClose} onSuccess={onSuccess} />
    )

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search permissions...')).toBeInTheDocument()
    })

    expect(userManagementService.listPermissions).toHaveBeenCalledWith({
      page_size: 500,
    })
  })

  it('should show loading state for permissions', () => {
    vi.mocked(userManagementService.listPermissions).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    )

    render(
      <CreateGroupDialog open={true} onClose={onClose} onSuccess={onSuccess} />
    )

    expect(screen.getByText('Loading permissions...')).toBeInTheDocument()
  })

  it('should submit form when group name is provided', async () => {
    vi.mocked(userManagementService.createGroup).mockResolvedValue(mockGroup)

    render(
      <CreateGroupDialog open={true} onClose={onClose} onSuccess={onSuccess} />
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Group Name *')).toBeInTheDocument()
    })

    // Fill in group name
    const nameInput = screen.getByLabelText('Group Name *')
    await userEvent.type(nameInput, 'New Group')

    const submitButton = screen.getByRole('button', { name: /create group/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(userManagementService.createGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Group',
        })
      )
    })
  })

  it('should show template tab', async () => {
    render(
      <CreateGroupDialog open={true} onClose={onClose} onSuccess={onSuccess} />
    )

    await waitFor(() => {
      expect(screen.getByText('Use Template')).toBeInTheDocument()
    })
  })

  it('should load role templates', async () => {
    render(
      <CreateGroupDialog open={true} onClose={onClose} onSuccess={onSuccess} />
    )

    await waitFor(() => {
      expect(userManagementService.getRoleTemplates).toHaveBeenCalled()
    })
  })
})

describe('DeleteGroupDialog', () => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render delete confirmation for regular groups', () => {
    render(
      <DeleteGroupDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        group={mockGroup}
      />
    )

    // Use getAllByText since there might be multiple elements with this text
    const deleteTexts = screen.getAllByText('Delete Group')
    expect(deleteTexts.length).toBeGreaterThan(0)

    expect(
      screen.getByText(/Are you sure you want to delete group/)
    ).toBeInTheDocument()
    expect(screen.getByText('Editors')).toBeInTheDocument()
  })

  it('should show warning for groups with users', () => {
    render(
      <DeleteGroupDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        group={mockGroup}
      />
    )

    expect(screen.getByText('Warning:')).toBeInTheDocument()
    expect(
      screen.getByText(/This group has 3 users/)
    ).toBeInTheDocument()
  })

  it('should show info for groups with permissions', () => {
    render(
      <DeleteGroupDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        group={mockGroup}
      />
    )

    expect(screen.getByText('Info:')).toBeInTheDocument()
    expect(
      screen.getByText(/This group has 2 permissions assigned/)
    ).toBeInTheDocument()
  })

  it('should prevent deletion of Admin group', () => {
    render(
      <DeleteGroupDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        group={mockAdminGroup}
      />
    )

    expect(screen.getByText('Cannot Delete Admin Group')).toBeInTheDocument()
    expect(
      screen.getByText(/The Admin group is a system group/)
    ).toBeInTheDocument()

    // Should not show delete button for admin group
    expect(screen.queryByRole('button', { name: /delete group/i })).not.toBeInTheDocument()
    // Should show Close button (use getAllByRole since there might be multiple close elements)
    const closeButtons = screen.getAllByRole('button', { name: /close/i })
    expect(closeButtons.length).toBeGreaterThan(0)
  })

  it('should call delete API on confirmation', async () => {
    vi.mocked(userManagementService.deleteGroup).mockResolvedValue(undefined)

    render(
      <DeleteGroupDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        group={mockGroup}
      />
    )

    const deleteButton = screen.getByRole('button', { name: /delete group/i })
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(userManagementService.deleteGroup).toHaveBeenCalledWith(mockGroup.id)
      expect(onSuccess).toHaveBeenCalled()
    })
  })

  it('should call onClose when cancel is clicked', () => {
    render(
      <DeleteGroupDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        group={mockGroup}
      />
    )

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    expect(onClose).toHaveBeenCalled()
  })
})
