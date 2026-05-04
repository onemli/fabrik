// SchemaDesigner/ColumnLibrary.tsx
//
// Reusable column library panel. Shows saved column definitions from the backend
// so the user can pick and add pre-built columns to their current schema instead
// of configuring each one from scratch.

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Star, Users, User } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ColumnTemplate {
  id: string;
  name: string;
  description: string;
  column_data: any;
  scope: 'user' | 'company';
  is_public: boolean;
  usage_count: number;
}

interface ColumnLibraryProps {
  onApply: (columnData: any) => void;
  onClose: () => void;
}

export const ColumnLibrary: React.FC<ColumnLibraryProps> = ({
  onApply,
  onClose
}) => {
  const [templates, setTemplates] = useState<ColumnTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedScope, setSelectedScope] = useState<string>('all');

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const response = await fetch('/api/awx/column-templates/');
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.results || data);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const filteredTemplates = templates.filter(template => {
    const matchesSearch =
      search === '' ||
      template.name.toLowerCase().includes(search.toLowerCase()) ||
      template.description?.toLowerCase().includes(search.toLowerCase());

    const matchesScope =
      selectedScope === 'all' ||
      (selectedScope === 'public' && template.is_public) ||
      (selectedScope === 'company' && template.scope === 'company') ||
      (selectedScope === 'user' && template.scope === 'user');

    return matchesSearch && matchesScope;
  });

  const handleApply = (template: ColumnTemplate) => {
    onApply(template.column_data);
  };

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      text: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
      textarea: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
      number: 'bg-green-500/10 text-green-600 dark:text-green-400',
      boolean: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
      select: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      multiselect: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      password: 'bg-red-500/10 text-red-600 dark:text-red-400'
    };
    return colors[type] || 'bg-muted/50 text-muted-foreground';
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Column Template Library</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Tabs */}
        <Tabs value={selectedScope} onValueChange={setSelectedScope} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid grid-cols-4">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="public">
              <Star className="w-4 h-4 mr-1" />
              Public
            </TabsTrigger>
            <TabsTrigger value="company">
              <Users className="w-4 h-4 mr-1" />
              Company
            </TabsTrigger>
            <TabsTrigger value="user">
              <User className="w-4 h-4 mr-1" />
              My Templates
            </TabsTrigger>
          </TabsList>

          <TabsContent value={selectedScope} className="flex-1 overflow-y-auto mt-4">
            {loading ? (
              <div className="text-center py-12 text-muted-foreground">
                Loading templates...
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No templates found.</p>
                {search && (
                  <p className="text-sm mt-2">Try a different search term.</p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredTemplates.map((template) => (
                  <Card key={template.id} className="p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h3 className="font-medium text-sm mb-1">{template.name}</h3>
                        <div className="flex items-center gap-2 text-xs">
                          <Badge className={getTypeColor(template.column_data.type)}>
                            {template.column_data.type}
                          </Badge>
                          {template.is_public && (
                            <Badge variant="outline" className="text-xs">
                              <Star className="w-3 h-3 mr-1" />
                              Public
                            </Badge>
                          )}
                          {template.scope === 'company' && (
                            <Badge variant="outline" className="text-xs">
                              <Users className="w-3 h-3 mr-1" />
                              Company
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleApply(template)}
                      >
                        Use
                      </Button>
                    </div>

                    {template.description && (
                      <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                        {template.description}
                      </p>
                    )}

                    <div className="text-xs text-muted-foreground flex items-center gap-3">
                      <span>Used {template.usage_count} times</span>
                      {template.column_data.required && (
                        <span className="text-red-600">Required</span>
                      )}
                    </div>

                    {/* Column details preview */}
                    <div className="mt-3 p-2 bg-gray-50 rounded text-xs">
                      <code className="text-foreground">
                        {template.column_data.name}
                      </code>
                      {template.column_data.validation && (
                        <div className="text-muted-foreground mt-1 font-mono truncate">
                          Regex: {template.column_data.validation}
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
