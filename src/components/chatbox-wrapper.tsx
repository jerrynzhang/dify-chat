import { MessageOutlined } from "@ant-design/icons";
import { Button, Form, FormItemProps, GetProp, Input, Select, Tag, Typography } from "antd";
import { Chatbox } from "./chatbox";
import { DifyApi, IGetAppInfoResponse, IGetAppParametersResponse } from "../utils/dify-api";
import { useEffect, useMemo, useState } from "react";
import { Bubble, BubbleProps, Prompts, useXAgent, useXChat, XStream } from "@ant-design/x";
import { RESPONSE_MODE, USER } from "../config";
import { MessageInfo } from "@ant-design/x/es/use-x-chat";
import MarkdownIt from "markdown-it";

const isTempId = (id: string | undefined) => {
  return id?.startsWith('temp');
};
interface IConversationEntryFormItem extends FormItemProps {
  type: 'input' | 'select';
}

const md = MarkdownIt({ html: true, breaks: true });

interface IChatboxWrapperProps {
  /**
   * 应用信息
   */
  appInfo?: IGetAppInfoResponse
  /**
   * 应用参数
   */
  appParameters?: IGetAppParametersResponse
  /**
   * Dify API 实例
   */
  difyApi: DifyApi
  /**
   * 当前对话 ID
   */
  conversationId?: string
  /**
   * 对话 ID 变更时触发的回调函数
   * @param id 即将变更的对话 ID
   */
  onConversationIdChange: (id: string) => void
}

export default function ChatboxWrapper(props: IChatboxWrapperProps) {
  const [entryForm] = Form.useForm();

  const { appInfo, appParameters, difyApi, conversationId, onConversationIdChange } = props
  const [content, setContent] = useState('');
  const [target, setTarget] = useState('');
  const [historyMessages, setHistoryMessages] = useState<MessageInfo<string>[]>(
    [],
  );
    const [userInputItems, setUserInputItems] = useState<
      IConversationEntryFormItem[]
    >([]);
      const [chatInitialized, setChatInitialized] = useState<boolean>(false);

  const [agent] = useXAgent({
    request: async ({ message }, { onSuccess, onUpdate }) => {
      console.log('进来了吗', message);

      // 发送消息
      const response = await difyApi.sendMessage({
        inputs: {
          target,
        },
        conversation_id: !isTempId(conversationId)
          ? conversationId
          : undefined,
        files: [],
        user: USER,
        response_mode: RESPONSE_MODE,
        query: message!,
      });

      let result = '';

      for await (const chunk of XStream({
        readableStream: response.body as NonNullable<ReadableStream>,
      })) {
        console.log('new chunk', chunk);
        if (chunk.data) {
          console.log('chunk.data', chunk.data);
          let parsedData = {} as {
            event: string;
            answer: string;
            conversation_id: string;
          };
          try {
            parsedData = JSON.parse(chunk.data);
          } catch (error) {
            console.error('解析 JSON 失败', error);
          }
          if (parsedData.event === 'message_end') {
            console.log('success一次', result)
            onSuccess(result);
          }
          if (!parsedData.answer) {
            console.log('没有数据', chunk);
          } else {
            const text = parsedData.answer;
            const conversation_id = parsedData.conversation_id;

            // 如果有对话 ID，跟当前的对比一下
            if (conversation_id) {
              // 如果当前对话 ID 是临时 ID, 则更新到当前对话 ID
              if (isTempId(conversationId)) {
                onConversationIdChange(conversation_id);
              }
            }
            console.log('text', text);
            result += text;
            console.log('enter onUpdate', result);
            onUpdate(result);
          }
        } else {
          console.log('没有数据', chunk);
          // continue;
        }
      }
    },
  });

  /**
   * 获取对话的历史消息
   */
  const getConversationMessages = async (conversationId: string) => {
    const result = await difyApi.getConversationHistory(conversationId);
    console.log('对话历史', result);

    const newMessages: MessageInfo<string>[] = [];

    if (result.data.length) {
      setTarget(result.data[0]?.inputs?.target);
    }

    result.data.forEach((item) => {
      newMessages.push(
        {
          id: `${item.id}-query`,
          message: item.query,
          status: 'success',
          isHistory: true,
        },
        {
          id: `${item.id}-answer`,
          message: item.answer,
          status: 'success',
          isHistory: true,
        },
      );
    });

    setHistoryMessages(newMessages);
  };

  const { onRequest, messages, setMessages } = useXChat({
    agent,
  });

  useEffect(() => {
    setChatInitialized(false);
    if (conversationId) {
      setMessages([]);
      getConversationMessages(conversationId);
    } else {
      if (appParameters?.user_input_form?.length) {
        // 有参数则展示表单
        const formItems =
        appParameters.user_input_form?.map((item) => {
            if (item['text-input']) {
              const originalProps = item['text-input'];
              const baseProps: IConversationEntryFormItem = {
                type: 'input',
                label: originalProps.label,
                name: originalProps.variable,
              };
              if (originalProps.required) {
                baseProps.required = true;
                baseProps.rules = [{ required: true, message: '请输入' }];
              }
              return baseProps;
            }
            return {} as IConversationEntryFormItem;
          }) || [];
        setUserInputItems(formItems);
      } else {
        setChatInitialized(true);
      }
    }
  }, [conversationId]);

  const onPromptsItemClick: GetProp<typeof Prompts, 'onItemClick'> = (info) => {
    onRequest(info.data.description as string);
  };

  const onSubmit = (nextContent: string) => {
    console.log('enter onSubmit', nextContent);
    if (!nextContent) return;
    console.log('onSubmit', nextContent);
    onRequest(nextContent);
    setContent('');
  };

  const renderMarkdown: BubbleProps['messageRender'] = (content) => (
    <Typography>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: used in demo */}
      <div dangerouslySetInnerHTML={{ __html: md.render(content) }} />
    </Typography>
  );

  const onChange = (nextContent: string) => {
    setContent(nextContent);
  };
  const items: GetProp<typeof Bubble.List, 'items'> = useMemo(() => {
    console.log('message变更', [...historyMessages, ...messages]);
    return [...historyMessages, ...messages].map((messageItem) => {
      const { id, message, status } = messageItem;
      const isQuery = id.toString().endsWith('query');
      return {
        key: id,
        // 不要开启 loading 和 typing, 否则流式会无效
        // loading: status === 'loading',
        content: message,
        messageRender: renderMarkdown,
        // 用户发送消息时，status 为 local，需要展示为用户头像
        role: isQuery || status === 'local' ? 'user' : 'ai',
      };
    });
  }, [historyMessages, messages]);

  return <>
    {!chatInitialized && userInputItems?.length ? (
      <div className="w-full h-full flex items-center justify-center -mt-5">
        <div className="w-96">
          <div className="text-2xl font-bold text-black mb-5">
            Dify Chat
          </div>
          <Form form={entryForm}>
            {userInputItems.map((item) => {
              return (
                <Form.Item
                  key={item.name}
                  name={item.name}
                  label={item.label}
                  required={item.required}
                  rules={item.rules}
                >
                  {item.type === 'input' ? (
                    <Input placeholder="请输入" />
                  ) : item.type === 'select' ? (
                    <Select placeholder="请选择" />
                  ) : (
                    '不支持的控件类型'
                  )}
                </Form.Item>
              );
            })}
          </Form>
          <Button
            block
            type="primary"
            icon={<MessageOutlined />}
            onClick={async () => {
              const result = await entryForm.validateFields();
              const values = entryForm.getFieldsValue();
              console.log('表单值', values);
              console.log('result', result);
              setTarget(entryForm.getFieldValue('target'));
              setChatInitialized(true);
            }}
          >
            开始对话
          </Button>
        </div>
      </div>
    ) : conversationId ? (
      <Chatbox
        items={items}
        content={content}
        isRequesting={agent.isRequesting()}
        onPromptsItemClick={onPromptsItemClick}
        onChange={onChange}
        onSubmit={onSubmit}
      />
    ) : appInfo ? (
      <div className="w-full h-full flex items-center justify-center text-black">
        <div className="flex items-center justify-center flex-col">
          <div className="text-2xl font-bold">{appInfo.name}</div>
          <div className="text-gray-700 text-base max-w-44 mt-3">
            {appInfo.description}
          </div>
          {appInfo.tags ? (
            <div>
              {appInfo.tags.map((tag) => {
                return <Tag key={tag}>{tag}</Tag>;
              })}
            </div>
          ) : null}
        </div>
      </div>
    ) : null}</>
}