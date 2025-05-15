import { PromptTags } from "./prompt";

export type Folder = {
	id: string;
	name: string;
	parentFolderId: string;
	tags: PromptTags;
};

export type MaximFolderResponse = {
	data: Folder;
	error?: { message: string };
};

export type MaximFoldersResponse = {
	data: Folder[];
	error?: { message: string };
};
