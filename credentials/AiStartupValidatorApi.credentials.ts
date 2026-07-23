import {
	Icon,
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class AiStartupValidatorApi implements ICredentialType {
	name = 'aiStartupValidatorApi';
	displayName = 'AI Startup Validator API';
	documentationUrl = 'https://platform.openai.com/docs/api-reference';
	icon: Icon = 'file:aiStartupValidator.svg';

	properties: INodeProperties[] = [
		{
			displayName: 'OpenAI API Key',
			name: 'openAiApiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
		{
			displayName: 'SerpApi Key',
			name: 'serpApiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: false,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.openAiApiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.openai.com/v1',
			url: '/models',
		},
	};
}