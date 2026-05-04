/**
 * User Management Dialogs Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateUserDialog } from './CreateUserDialog'
import { EditUserDialog } from './EditUserDialog'
import { ResetPasswordDialog } from './ResetPasswordDialog'
import { DeleteConfirmDialog } from './DeleteConfirmDialog'
import { userManagementService } from '@/services/userManagement'
import type { UserManagementUser, GroupBasic } from '@/services/userManagement'

// Mock dependencies
vi.mock('@/services/userManagement')
vi.mock('@/store/queryBuilderStore', () => ({
  useQueryBuilderStore: () => ({
    showLogoNotification: vi.fn(),
  }),
}))

const mockGroups: GroupBasic[] = [
  {
    id: 1,
    name: 'Admin',
  },
  {
    id: 2,
    name: 'Users',
  },
]

const mockUser: UserManagementUser = {
  id: 1,
  username: 'testuser',
  email: 'test@test.com',
  first_name: 'Test',
  last_name: 'User',
  is_active: true,
  is_staff: false,
  is_superuser: false,
  groups: [{ id: 2, name: 'Users' }],
  group_names: ['Users'],
  is_admin: false,
  date_joined: '2024-01-01T00:00:00Z',
  query_count: 10,
  last_login: '2024-01-01T00:00:00Z',
}

describe('CreateUserDialog', () => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render create user form', async () => {
    render(
      <CreateUserDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        groups={mockGroups}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Create New User')).toBeInTheDocument()
    })

    expect(screen.getByLabelText('Username *')).toBeInTheDocument()
    expect(screen.getByLabelText('Email *')).toBeInTheDocument()
    expect(screen.getByLabelText('Password *')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm Password *')).toBeInTheDocument()
    expect(screen.getByLabelText('First Name *')).toBeInTheDocument()
    expect(screen.getByLabelText('Last Name *')).toBeInTheDocument()
  })

  it('should display provided groups', async () => {
    render(
      <CreateUserDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        groups={mockGroups}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Admin')).toBeInTheDocument()
      expect(screen.getByText('Users')).toBeInTheDocument()
    })
  })

  it('should submit form with valid data', async () => {
    vi.mocked(userManagementService.createUser).mockResolvedValue(mockUser)

    render(
      <CreateUserDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        groups={mockGroups}
      />
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Username *')).toBeInTheDocument()
    })

    await userEvent.type(screen.getByLabelText('Username *'), 'newuser')
    await userEvent.type(screen.getByLabelText('Email *'), 'new@test.com')
    await userEvent.type(screen.getByLabelText('First Name *'), 'New')
    await userEvent.type(screen.getByLabelText('Last Name *'), 'User')
    await userEvent.type(screen.getByLabelText('Password *'), 'password123')
    await userEvent.type(screen.getByLabelText('Confirm Password *'), 'password123')

    const submitButton = screen.getByRole('button', { name: /create user/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(userManagementService.createUser).toHaveBeenCalled()
      expect(onSuccess).toHaveBeenCalled()
    })
  })

  it('should not submit when passwords do not match', async () => {
    render(
      <CreateUserDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        groups={mockGroups}
      />
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Password *')).toBeInTheDocument()
    })

    await userEvent.type(screen.getByLabelText('Username *'), 'newuser')
    await userEvent.type(screen.getByLabelText('Email *'), 'new@test.com')
    await userEvent.type(screen.getByLabelText('First Name *'), 'New')
    await userEvent.type(screen.getByLabelText('Last Name *'), 'User')
    await userEvent.type(screen.getByLabelText('Password *'), 'password123')
    await userEvent.type(screen.getByLabelText('Confirm Password *'), 'differentpassword')

    const submitButton = screen.getByRole('button', { name: /create user/i })
    fireEvent.click(submitButton)

    // Should not call API with mismatched passwords
    await waitFor(() => {
      expect(userManagementService.createUser).not.toHaveBeenCalled()
    })
  })

  it('should allow toggling groups', async () => {
    render(
      <CreateUserDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        groups={mockGroups}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Admin')).toBeInTheDocument()
    })

    // Get checkboxes for groups
    const adminCheckbox = screen.getByRole('checkbox', { name: /admin/i })
    expect(adminCheckbox).not.toBeChecked()

    await userEvent.click(adminCheckbox)
    expect(adminCheckbox).toBeChecked()
  })
})

describe('EditUserDialog', () => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.skip('should render edit user form with existing data', async () => {
    render(
      <EditUserDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        user={mockUser}
        groups={mockGroups}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Edit User:/)).toBeInTheDocument()
    })

    expect(screen.getByDisplayValue('test@test.com')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test')).toBeInTheDocument()
    expect(screen.getByDisplayValue('User')).toBeInTheDocument()
  })

  it.skip('should submit updated user data', async () => {
    vi.mocked(userManagementService.updateUser).mockResolvedValue(mockUser)

    render(
      <EditUserDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        user={mockUser}
        groups={mockGroups}
      />
    )

    await waitFor(() => {
      expect(screen.getByDisplayValue('test@test.com')).toBeInTheDocument()
    })

    const emailInput = screen.getByDisplayValue('test@test.com')
    await userEvent.clear(emailInput)
    await userEvent.type(emailInput, 'updated@test.com')

    const submitButton = screen.getByRole('button', { name: /update user/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(userManagementService.updateUser).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          email: 'updated@test.com',
        })
      )
      expect(onSuccess).toHaveBeenCalled()
    })
  })

  it.skip('should pre-select user groups', async () => {
    render(
      <EditUserDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        user={mockUser}
        groups={mockGroups}
      />
    )

    await waitFor(() => {
      // Users group should be checked (user is member)
      const usersCheckbox = screen.getByRole('checkbox', { name: /users/i })
      expect(usersCheckbox).toBeChecked()

      // Admin group should not be checked — use exact name to avoid matching is_staff label
      const adminCheckbox = screen.getByRole('checkbox', { name: 'Admin' })
      expect(adminCheckbox).not.toBeChecked()
    })
  })
})

describe('ResetPasswordDialog', () => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render reset password form', () => {
    render(
      <ResetPasswordDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        user={mockUser}
      />
    )

    // Title includes username
    expect(screen.getByText(/Reset Password for/)).toBeInTheDocument()
    expect(screen.getByLabelText('New Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm New Password')).toBeInTheDocument()
  })

  it('should not submit when passwords do not match', async () => {
    render(
      <ResetPasswordDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        user={mockUser}
      />
    )

    const passwordInput = screen.getByLabelText('New Password')
    const confirmInput = screen.getByLabelText('Confirm New Password')

    await userEvent.type(passwordInput, 'newpassword123')
    await userEvent.type(confirmInput, 'differentpassword')

    const submitButton = screen.getByRole('button', { name: /reset password/i })
    fireEvent.click(submitButton)

    // Should not call API with mismatched passwords
    await waitFor(() => {
      expect(userManagementService.resetPassword).not.toHaveBeenCalled()
    })
  })

  it('should submit password reset with matching passwords', async () => {
    vi.mocked(userManagementService.resetPassword).mockResolvedValue(undefined)

    render(
      <ResetPasswordDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        user={mockUser}
      />
    )

    await userEvent.type(screen.getByLabelText('New Password'), 'newpassword123')
    await userEvent.type(
      screen.getByLabelText('Confirm New Password'),
      'newpassword123'
    )

    const submitButton = screen.getByRole('button', { name: /reset password/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(userManagementService.resetPassword).toHaveBeenCalledWith(
        mockUser.id,
        'newpassword123',
        'newpassword123'
      )
      expect(onSuccess).toHaveBeenCalled()
    })
  })

  it('should call onClose when cancel is clicked', () => {
    render(
      <ResetPasswordDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        user={mockUser}
      />
    )

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    expect(onClose).toHaveBeenCalled()
  })
})

describe('DeleteConfirmDialog', () => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render delete confirmation dialog', () => {
    render(
      <DeleteConfirmDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        user={mockUser}
      />
    )

    // Use getAllByText since there's both title and button with "Delete User"
    const deleteUserTexts = screen.getAllByText(/Delete User/)
    expect(deleteUserTexts.length).toBeGreaterThan(0)
    expect(
      screen.getByText(/Are you sure you want to delete user/)
    ).toBeInTheDocument()
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()
  })

  it('should show warning for users with queries', () => {
    render(
      <DeleteConfirmDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        user={mockUser}
      />
    )

    expect(screen.getByText('Warning:')).toBeInTheDocument()
    expect(
      screen.getByText(/This user has 10 queries/)
    ).toBeInTheDocument()
  })

  it('should not show warning for users without queries', () => {
    const userWithoutQueries = { ...mockUser, query_count: 0 }

    render(
      <DeleteConfirmDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        user={userWithoutQueries}
      />
    )

    expect(screen.queryByText('Warning:')).not.toBeInTheDocument()
  })

  it('should call delete API on confirmation', async () => {
    vi.mocked(userManagementService.deleteUser).mockResolvedValue(undefined)

    render(
      <DeleteConfirmDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        user={mockUser}
      />
    )

    const deleteButton = screen.getByRole('button', { name: /delete user/i })
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(userManagementService.deleteUser).toHaveBeenCalledWith(mockUser.id)
      expect(onSuccess).toHaveBeenCalled()
    })
  })

  it('should call onClose when cancel is clicked', () => {
    render(
      <DeleteConfirmDialog
        open={true}
        onClose={onClose}
        onSuccess={onSuccess}
        user={mockUser}
      />
    )

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    expect(onClose).toHaveBeenCalled()
  })
})
